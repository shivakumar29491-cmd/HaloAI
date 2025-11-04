// main.js — HaloAI (SoX recorder, low-latency pipeline, Whisper + Answer hints)
require('dotenv').config();

// --- Ensure SoX is reachable on Windows ---
process.env.PATH = [
  'C:\\Program Files\\sox',
  'C:\\Program Files (x86)\\sox-14-4-2',
  process.env.PATH || ''
].join(';');

const { app, BrowserWindow, ipcMain, dialog, globalShortcut } = require('electron');
const { spawn } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

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
// Quick answer helper (GPT with graceful fallback)
// --------------------------------------------------
async function askOpenAI(userText){
  if (!process.env.OPENAI_API_KEY) {
    // Fallback suggestions when no key is configured
    const hints = localHints(userText);
    send('log', '[answer] OPENAI_API_KEY not set — showing local suggestions.');
    return hints;
  }
  try{
    const fetch = (...a) => import('node-fetch').then(({default:f}) => f(...a));
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers:{
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type':'application/json'
      },
      body: JSON.stringify({
        model: process.env.FALLBACK_MODEL || 'gpt-4o-mini',
        messages:[
  {
    role:'system',
    content: `You are HaloAI, a real-time assistant.
Respond instantly and confidently to whatever the user says.
Never ask clarifying questions — just answer directly.
If the user says something incomplete, assume intent and reply helpfully.`
  },
  { role:'user', content:userText }
]

      })
    });
    if (!r.ok) {
      const body = await r.text();
      send('log', `[answer:error] ${r.status} ${r.statusText} — ${body}`);
      return localHints(userText);
    }
    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content || '';
    return content || localHints(userText);
  } catch(e){
    send('log', `[answer:error] ${e.message}`);
    return localHints(userText);
  }
}

// Very light local suggestions when GPT is unavailable
function localHints(t='') {
  const s = t.toLowerCase();
  if (s.includes('salesforce')) {
    return 'Tip: Do you want a quick overview of Sales Cloud vs Service Cloud, or sample Apex + OmniStudio patterns?';
  }
  if (s.includes('meeting') || s.includes('agenda')) {
    return 'Suggestion: Should I summarize key points so far and track action items?';
  }
  if (s.includes('deadline') || s.includes('date')) {
    return 'Reminder idea: Want me to set a follow-up reminder with the due date?';
  }
  return 'Got it. Want me to summarize this chunk or draft a short response?';
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
// SoX recorder (Windows waveaudio) — fixed rate/bitdepth/mono
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
// Live loop — pipelined (record next chunk immediately)
// --------------------------------------------------
let live = { on:false, idx:0, transcript:'' };

// Default/configurable fields for UI (shorter chunk for low latency)
let recConfig = { device: 'default', gainDb: '0', chunkMs: 1500 };

function startChunk() {
  const dMs = recConfig.chunkMs || 1500;
  const outfile = tmpWav(live.idx);

  // Called when recording of this chunk finishes
  const after = () => {
    const size = fs.existsSync(outfile) ? fs.statSync(outfile).size : 0;
    send('log', `[chunk] ${outfile} size=${size} bytes`);

    // Kick off Whisper + answer asynchronously (non-blocking)
    (async () => {
      try {
        const text = (await runWhisper(outfile)) || '';
        if (text) {
          live.transcript += (live.transcript ? ' ' : '') + text;
          send('live:transcript', live.transcript);

          const answer = await askOpenAI(text);
          send('live:answer', `(HaloAI): ${answer}`);

          if (answer) send('live:answer', answer);
        } else {
          send('log', '[whisper] (empty transcript)');
        }
      } catch (e) {
        send('log', `[whisper:error] ${e.message}`);
      }
    })();

    // Immediately schedule the next recording (pipeline)
    if (live.on) { live.idx += 1; startChunk(); }
  };

  recordWithSox(outfile, dMs, after);
}

ipcMain.handle('live:start', async () => {
  if (live.on) return { ok:true };
  live = { on:true, idx:0, transcript:'' };
  startChunk();
  return { ok:true };
});
ipcMain.handle('live:stop', async () => { live.on = false; return { ok:true }; });

// --------------------------------------------------
// File mode (manual pick)
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
// Renderer compatibility shims (device/config/test)
// --------------------------------------------------
ipcMain.handle('sox:devices', async () => {
  // We use Windows default device — still return dropdown value for UI
  return { items: [], selected: recConfig.device || 'default' };
});
ipcMain.handle('rec:getConfig', async () => recConfig);
ipcMain.handle('rec:setConfig', async (_e, cfg) => {
  if (cfg?.device !== undefined) recConfig.device = String(cfg.device || 'default');
  if (cfg?.gainDb !== undefined) recConfig.gainDb = String(cfg.gainDb || '0');
  if (cfg?.chunkMs !== undefined) {
    // clamp to 500–4000 ms for stability (lower => lower latency)
    const v = Math.max(500, Math.min(4000, Number(cfg.chunkMs) || 1500));
    recConfig.chunkMs = v;
  }
  send('log', `[rec] updated: device=${recConfig.device}, gain=${recConfig.gainDb}dB, chunkMs=${recConfig.chunkMs}`);
  return { ok: true, recConfig };
});

// Test Mic (3s): record via SoX then run Whisper + answer (to verify end-to-end)
ipcMain.handle('rec:test', async () => {
  const testfile = path.join(tmpDir(), `test_${Date.now()}.wav`);
  return new Promise((resolve) => {
    const after = async () => {
      let size = 0;
      try { size = fs.statSync(testfile).size; } catch {}
      const out = { ok:true, file:testfile, size, transcript:'' };
      try {
        send('log', `[test] wrote ${size} bytes to ${testfile}`);
        const text = await runWhisper(testfile);
        out.transcript = text || '';
        // Also demonstrate the answer path here
        const answer = text ? await askOpenAI(text) : '';
        if (answer) send('live:answer', answer);
      } catch (e) {
        out.ok = false; out.error = e.message || String(e);
      }
      resolve(out);
    };
    recordWithSox(testfile, 3000, after);
  });
});

// --------------------------------------------------
// Window / env IPC
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
