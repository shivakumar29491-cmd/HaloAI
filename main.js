// =====================================================
// HaloAI — main.js (SoX Recorder + Whisper + Web Search Fallback)
// =====================================================
require('dotenv').config();

const { app, BrowserWindow, ipcMain, dialog, globalShortcut } = require('electron');
const { spawn } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { URL } = require('url');

// --- Ensure SoX is reachable on Windows ---
process.env.PATH = [
  'C:\\Program Files\\sox',
  'C:\\Program Files (x86)\\sox-14-4-2',
  process.env.PATH || ''
].join(';');

// --------------------------------------------------
// Window helpers
// --------------------------------------------------
let win;
function send(channel, payload) {
  if (win && !win.isDestroyed()) {
    try { win.webContents.send(channel, payload); } catch {}
  }
}
function createWindow() {
  win = new BrowserWindow({
    width: 920,
    height: 750,
    frame: false,
    backgroundColor: '#0b1220',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile('index.html').catch(e => console.error('[boot] loadFile error', e));
  win.on('closed', () => { win = null; });
}
app.whenReady().then(() => {
  createWindow();
  try {
    globalShortcut.register('CommandOrControl+Shift+Space', () => {
      if (!win) return;
      if (win.isVisible()) win.hide(); else win.show();
    });
  } catch (e) { console.error('[shortcut] register error:', e.message); }
});
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch {} });
app.on('window-all-closed', () => app.quit());

// --------------------------------------------------
// Whisper config
// --------------------------------------------------
const WHISPER_BIN = process.env.WHISPER_BIN
  || 'C:\\dev\\whisper.cpp\\build\\bin\\Release\\whisper-cli.exe';
const WHISPER_MODEL = process.env.WHISPER_MODEL
  || 'C:\\dev\\whisper.cpp\\models\\ggml-base.en.bin';
const LANG = process.env.WHISPER_LANG || 'en';

function runWhisper(filePath) {
  return new Promise((resolve, reject) => {
    try {
      if (!fs.existsSync(filePath)) return reject(new Error('audio not found'));
      const outTxt = `${filePath}.txt`;
      try { if (fs.existsSync(outTxt)) fs.unlinkSync(outTxt); } catch {}

      const args = ['-m', WHISPER_MODEL, '-f', filePath, '-otxt', '-l', LANG, '-t', '4'];
      send('log', `[spawn] ${WHISPER_BIN}\n[args] ${args.join(' ')}`);

      const child = spawn(WHISPER_BIN, args, { windowsHide: true });
      child.stdout.on('data', d => send('log', d.toString()));
      child.stderr.on('data', d => send('log', `[stderr] ${d.toString()}`));
      child.on('close', () => {
        try {
          const text = fs.existsSync(outTxt) ? fs.readFileSync(outTxt, 'utf8').trim() : '';
          resolve(text);
        } catch (e) { reject(e); }
      });
      child.on('error', reject);
    } catch (e) { reject(e); }
  });
}

// --------------------------------------------------
// Free Web Search (DuckDuckGo + Cheerio)
// --------------------------------------------------
async function duckDuckGoSearch(query, maxResults = 5) {
  const q = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${q}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = await res.text();
  const $ = cheerio.load(html);
  const links = [];
  $('a.result__a').each((i, el) => {
    if (links.length >= maxResults) return;
    const href = $(el).attr('href');
    if (!href) return;
    try { const u = new URL(href, 'https://duckduckgo.com'); links.push(u.href); }
    catch { links.push(href); }
  });
  if (links.length === 0) {
    $('a').each((i, el) => {
      if (links.length >= maxResults) return;
      const href = $(el).attr('href');
      if (href && href.startsWith('http')) links.push(href);
    });
  }
  return links.slice(0, maxResults);
}

async function fetchAndExtract(url) {
  try {
    const res = await fetch(url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });

    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);

    // Collect visible paragraphs, skipping menus/footers/scripts
    const paras = [];
    $('p, article p, div p, section p').each((i, el) => {
      let t = $(el).text().replace(/\s+/g, ' ').trim();
      if (t.length > 50 && !/cookie|subscribe|advert/i.test(t)) paras.push(t);
    });

    // Try alternative containers if no paragraphs found
    if (paras.length === 0) {
      $('div').each((i, el) => {
        const t = $(el).text().replace(/\s+/g, ' ').trim();
        if (t.length > 80 && t.split(' ').length > 10) paras.push(t);
      });
    }

    // Remove duplicates and short entries
    const uniq = Array.from(new Set(paras))
      .filter(p => p.length > 40)
      .slice(0, 10);

    if (uniq.length === 0) return null;

    // Join paragraphs into a single text block
    return uniq.join('\n\n');
  } catch (e) {
    send('log', `[fetchAndExtract error] ${e.message}`);
    return null;
  }
}
function extractiveSummary(text, query, maxSentences = 6) {
  if (!text) return '';
  const qwords = query.toLowerCase().split(/\s+/).filter(Boolean);
  const sents = text.split(/(?<=[.!?])\s+/);
  const scored = sents.map(s => {
    const lw = s.toLowerCase();
    let score = 0;
    qwords.forEach(q => { if (lw.includes(q)) score++; });
    return { s: s.trim(), score };
  }).sort((a,b) => b.score - a.score);
  const chosen = scored.filter(x => x.s.length > 30).slice(0, maxSentences).map(x => x.s);
  return chosen.length ? chosen.join(' ') : sents.slice(0, maxSentences).join(' ').trim();
}
async function webSearchFallback(query) {
  try {
    const links = await duckDuckGoSearch(query, 4);
    const results = [];

    for (const url of links) {
      if (!url.startsWith('http')) continue;

      // Fetch and summarize text from the page
      const text = await fetchAndExtract(url);
      const summary = extractiveSummary(text || '', query, 4);

      if (summary && summary.length > 0) {
        results.push({ url, summary });
      }
    }

    // If no summaries found, fallback to a basic message
    if (results.length === 0) {
      return `Sorry, I couldn’t find detailed explanations for "${query}". Try rephrasing your question.`;
    }

    // Combine brief readable explanations instead of raw URLs
    let combined = `🌐 Here's what I found about "${query}":\n\n`;
    results.forEach((r, i) => {
      combined += `🟢 ${i + 1}. ${r.summary}\n\n`;
    });

    // Add a small note for transparency
    combined += `💡 (Summaries auto-generated from public web sources)\n`;
    return combined.trim();
  } catch (e) {
    return `(web search error) ${e.message}`;
  }
}


// --------------------------------------------------
// OpenAI answer (with auto web fallback)
// --------------------------------------------------
async function askOpenAI(userText) {
  try {
    if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_API_KEY.trim()) {
      send('log', '[OpenAI] Missing API key — fallback to web search');
      return await webSearchFallback(userText);
    }

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.FALLBACK_MODEL || 'gpt-4o-mini',
        temperature: 0.7,
        max_tokens: 200,
        messages: [
          {
            role: 'system',
            content: `You are HaloAI, a helpful assistant. Respond directly and clearly.`
          },
          { role: 'user', content: userText }
        ]
      })
    });

    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { send('log', `[OpenAI raw] ${text}`); }

    if (json?.error?.message) {
      send('log', `[OpenAI Error] ${json.error.message} — using web fallback`);
      return await webSearchFallback(userText);
    }

    const output = json?.choices?.[0]?.message?.content?.trim();
    if (!output) return await webSearchFallback(userText);
    send('log', `[OpenAI reply] ${output}`);
    return output;
  } catch (e) {
    send('log', `[OpenAI Exception] ${e.message} — fallback to web`);
    return await webSearchFallback(userText);
  }
}

// --------------------------------------------------
// Paths / temp files
// --------------------------------------------------
function tmpDir() {
  const dir = path.join(os.tmpdir(), 'haloai');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function tmpWav(idx){ return path.join(tmpDir(), `chunk_${idx}.wav`); }

// --------------------------------------------------
// SoX recorder (Windows waveaudio)
// --------------------------------------------------
function recordWithSox(outfile, ms, onDone) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  const args = [
    '-q', '-t', 'waveaudio', 'default',
    '-r','16000','-b','16','-c','1',
    outfile,
    'trim','0', String(seconds),
    'silence','1','0.1','1%','-1','0.5','1%'
  ];
  send('log', `[sox] ${args.join(' ')}`);
  try {
    const child = spawn('sox', args, { windowsHide: true });
    child.on('error', e => send('log', `[sox:error] ${e.message}`));
    child.on('close', () => { try { onDone && onDone(); } catch {} });
  } catch (e) {
    send('log', `[sox:spawn:failed] ${e.message}`);
    try { onDone && onDone(e); } catch {}
  }
}

// --------------------------------------------------
// Live pipeline (record + transcribe + answer)
// --------------------------------------------------
let live = { on:false, idx:0, transcript:'' };
let recConfig = { device: 'default', gainDb: '0', chunkMs: 1500 };

function startChunk() {
  const dMs = recConfig.chunkMs || 1500;
  const outfile = tmpWav(live.idx);

  const after = () => {
    const size = fs.existsSync(outfile) ? fs.statSync(outfile).size : 0;
    send('log', `[chunk] ${outfile} size=${size} bytes`);
    (async () => {
      try {
        const text = (await runWhisper(outfile)) || '';
        if (text) {
          live.transcript += (live.transcript ? ' ' : '') + text;
          send('live:transcript', live.transcript);
          const answer = await askOpenAI(text);
          if (answer) send('live:answer', answer);
        } else send('log', '[whisper] (empty transcript)');
      } catch (e) { send('log', `[whisper:error] ${e.message}`); }
    })();
    if (live.on) { live.idx += 1; startChunk(); }
  };
  recordWithSox(outfile, dMs, after);
}
ipcMain.handle('live:start', async () => { if (live.on) return { ok:true }; live = { on:true, idx:0, transcript:'' }; startChunk(); return { ok:true }; });
ipcMain.handle('live:stop', async () => { live.on = false; return { ok:true }; });

// --------------------------------------------------
// File Mode (manual file transcribe)
// --------------------------------------------------
ipcMain.handle('pick:audio', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['wav','mp3','m4a','ogg'] }]
  });
  return canceled ? null : filePaths[0];
});
ipcMain.handle('whisper:transcribe', async (_evt, audioPath) => {
  try { const t = await runWhisper(audioPath); return { code: 0, output: t }; }
  catch (e) { send('log', `[error] ${e.message}`); return { code: -1, output: '' }; }
});

// --------------------------------------------------
// Config + Mic Test
// --------------------------------------------------
ipcMain.handle('sox:devices', async () => ({ items: [], selected: recConfig.device || 'default' }));
ipcMain.handle('rec:getConfig', async () => recConfig);
ipcMain.handle('rec:setConfig', async (_e, cfg) => {
  if (cfg?.device !== undefined) recConfig.device = String(cfg.device || 'default');
  if (cfg?.gainDb !== undefined) recConfig.gainDb = String(cfg.gainDb || '0');
  if (cfg?.chunkMs !== undefined) {
    const v = Math.max(500, Math.min(4000, Number(cfg.chunkMs) || 1500));
    recConfig.chunkMs = v;
  }
  send('log', `[rec] updated: device=${recConfig.device}, gain=${recConfig.gainDb}dB, chunkMs=${recConfig.chunkMs}`);
  return { ok: true, recConfig };
});

ipcMain.handle('rec:test', async () => {
  const testfile = path.join(tmpDir(), `test_${Date.now()}.wav`);
  return new Promise((resolve) => {
    const after = async () => {
      let size = 0;
      try { size = fs.statSync(testfile).size; } catch {}
      const out = { ok:true, file:testfile, size, transcript:'' };
      try {
        send('log', `[test] wrote ${size} bytes`);
        const text = await runWhisper(testfile);
        out.transcript = text || '';
        const answer = text ? await askOpenAI(text) : '';
        if (answer) send('live:answer', answer);
      } catch (e) { out.ok = false; out.error = e.message || String(e); }
      resolve(out);
    };
    recordWithSox(testfile, 3000, after);
  });
});

// --------------------------------------------------
// Window controls
// --------------------------------------------------
ipcMain.handle('window:minimize', () => { if (win && !win.isDestroyed()) win.minimize(); });
ipcMain.handle('window:maximize', () => {
  if (!win || win.isDestroyed()) return;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
});
ipcMain.handle('window:close', () => app.exit(0));
ipcMain.handle('env:get', () => ({
  APP_NAME: process.env.APP_NAME || 'HaloAI',
  OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
  FALLBACK_MODEL: process.env.FALLBACK_MODEL || 'gpt-4o-mini'
}));
