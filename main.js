// =====================================================
// HaloAI — main.js (Recorder + Whisper + Chat + Doc QA + Live Companion)
// Phase 5.11–5.15 updates included + Brave API wiring
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
let pdfParse = null; // lazy-load for PDFs
const sharp = require("sharp");
const { desktopCapturer } = require("electron");
const Tesseract = require("tesseract.js");
const { triggerSnip } = require("./triggerSnip");
const { clipboard } = require("electron");
const { exec } = require("child_process");
// --- Groq Fast Engines ---
const { groqWhisperTranscribe, groqFastAnswer } = require("./groqEngine");




const { smartSearch, getProviderStats } = require('./searchRoot/searchRouter');
const { BraveApi }    = require('./searchRoot/engines/braveApi');
const { initScreenReader } = require('./screenReader');

process.env.PATH = [
  'C:\\Program Files\\sox',
  'C:\\Program Files (x86)\\sox-14-4-2',
  process.env.PATH || ''
].join(';');

// ---------------- Window ----------------
let win;


function send(ch, payload) {
  if (win && !win.isDestroyed()) {
    try { win.webContents.send(ch, payload); } catch {}
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 920,
    height: 750,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    titleBarStyle: 'hidden',
    backgroundMaterial: 'mica',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile('indexRoot.html').catch(e => console.error('[boot] loadFile error', e));
  win.on('closed', () => { win = null; });
}



// --- Web search engines (Brave wrapper) ---
let braveSearch = null;

function initSearchEngines() {
  try {
    braveSearch = new BraveApi({
      log: (msg) => send('log', `[Brave] ${msg}`)
    });
    send('log', '[Brave] search engine initialized.');
  } catch (e) {
    send('log', `[Brave:init:error] ${e.message}`);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 920,
    height: 750,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    titleBarStyle: 'hidden',
    backgroundMaterial: 'mica',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile('indexRoot.html').catch(e => console.error('[boot] loadFile error', e));
  win.on('closed', () => { win = null; });
}
app.whenReady().then(() => {
  initSearchEngines(); // NEW: wire Brave on boot
  createWindow();
  try {
    globalShortcut.register('CommandOrControl+Shift+Space', () => {
      if (!win) return;
      win.isVisible() ? win.hide() : win.show();
    });
  } catch {}
});
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch {} });
app.on('window-all-closed', () => app.quit());

// ---------------- Whisper (tuned for speed) ----------------
const WHISPER_BIN     = process.env.WHISPER_BIN     || 'C:\\dev\\whisper.cpp\\build\\bin\\Release\\whisper-cli.exe';
const WHISPER_MODEL   = process.env.WHISPER_MODEL   || 'C:\\dev\\whisper.cpp\\models\\ggml-tiny.en.bin'; // fastest sensible default
const WHISPER_THREADS = Number(process.env.WHISPER_THREADS || 4);
const WHISPER_NGL     = String(process.env.WHISPER_NGL || '0'); // GPU offload layers if compiled (e.g. "20")
const LANG            = process.env.WHISPER_LANG || 'en';

function runWhisper(filePath){
  return new Promise((resolve, reject) => {
    try{
      if (!fs.existsSync(filePath)) return reject(new Error('audio not found'));
      const st = fs.statSync(filePath);
      if (!st || st.size < 2000) { send('log','[whisper] skipped empty/small chunk'); return resolve(''); }
      const outTxt = `${filePath}.txt`;
      try { if (fs.existsSync(outTxt)) fs.unlinkSync(outTxt); } catch {}

      const args = [
        '-m', WHISPER_MODEL,
        '-f', filePath,
        '-otxt',
        '-l', LANG,
        '-t', String(WHISPER_THREADS)
      ];
      if (Number(WHISPER_NGL) > 0) {
        args.push('-ngl', String(WHISPER_NGL));
      }

      send('log', `[spawn] ${WHISPER_BIN}\n[args] ${args.join(' ')}`);
      const child = spawn(WHISPER_BIN, args, { windowsHide:true });
      child.stdout.on('data', d => send('log', d.toString()));
      let _stderr='';
      child.stderr.on('data', d => { const s=d.toString(); _stderr+=s; send('log', `[stderr] ${s}`); });
      child.on('close', () => {
        try {
          if (/\b(usage:|Voice Activity Detection|options:)\b/i.test(_stderr)) {
            send('log','[whisper] usage/help detected — treating as empty');
            return resolve('');
          }
          const text = fs.existsSync(outTxt) ? fs.readFileSync(outTxt, 'utf8').trim() : '';
          resolve(text);
        } catch(e){ reject(e); }
      });
      child.on('error', reject);
    }catch(e){ reject(e); }
  });
}

// ---------------- Web utils (legacy DuckDuckGo helpers, backup only) ----------------
async function duckDuckGoSearch(query, maxResults = 5) {
  const q = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${q}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = await res.text();
  const $ = cheerio.load(html);
  const links = [];
  $('a.result__a').each((i, el) => {
    if (links.length >= maxResults) return;
    const href = $(el).attr('href'); if (!href) return;
    try { const u = new URL(href, 'https://duckduckgo.com'); links.push(u.href); } catch { links.push(href); }
  });
  if (links.length === 0) $('a').each((i, el) => {
    if (links.length >= maxResults) return;
    const href = $(el).attr('href'); if (href && href.startsWith('http')) links.push(href);
  });
  return links.slice(0, maxResults);
}

async function fetchAndExtract(url) {
  try{
    // Phase 5.14: tighten timeout + minimal HTML scanning
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);
    const paras = [];
    // Only scan minimal content-ish nodes
    $('p, article, div.content, section').each((i, el) => {
      let t = $(el).text().replace(/\s+/g,' ').trim();
      if (t.length > 50 && !/cookie|subscribe|advert/i.test(t)) paras.push(t);
    });

    const uniq = Array.from(new Set(paras)).filter(p => p.length > 40).slice(0, 10);
    if (uniq.length === 0) return null;
    return uniq.join('\n\n');
  }catch(e){
    send('log', `[fetchAndExtract error] ${e.message}`);
    return null;
  }
}

function extractiveSummary(text, query, maxSentences = 6) {
  if (!text) return '';
  const qwords = (query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const sents = text.split(/(?<=[.!?])\s+/);
  const scored = sents.map(s => {
    const lw = s.toLowerCase(); let score = 0;
    qwords.forEach(q => { if (lw.includes(q)) score++; });
    return { s: s.trim(), score };
  }).sort((a,b) => b.score-a);
  const chosen = scored.filter(x => x.s.length > 30).slice(0, maxSentences).map(x => x.s);
  return chosen.length ? chosen.join(' ') : sents.slice(0, maxSentences).join(' ').trim();
}

// ---------------- Answering state/funcs ----------------
let docContext = { name:'', text:'', tokens:null };
let webPlus   = false;   // backend flag (UI removed)
let useDoc    = false;   // default OFF so answers are AI-only
let docEnrich = false;   // Phase 5.12: doc-enrichment mode

// Phase 5.15: API preference (Fastest / Cheapest / Most accurate / Local only)
let searchPrefs = { mode: 'fastest' }; // default

// Phase 5.14: simple in-process cache for search results (10 minutes)
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const searchCache = new Map(); // key -> { ts, results }

async function cachedSmartSearch(query, opts = {}) {
  const key = String(query || '').trim().toLowerCase();
  const now = Date.now();
  const cached = searchCache.get(key);
  if (cached && (now - cached.ts) < SEARCH_CACHE_TTL_MS) {
    send('log', `[api] provider=cache kind=web ms=0`);
    return cached.results;
  }

  const t0 = Date.now();
  const { unifiedWebSearch } = require("./searchRoot/searchRouter");
const results = await unifiedWebSearch(query, 5);

  const ms = Date.now() - t0;
  send('log', `[api] provider=router kind=web ms=${ms}`);

  if (results && Array.isArray(results)) {
    searchCache.set(key, { ts: now, results });
  }
  return results;
}

// token helpers
const STOP = new Set('a an and are as at be by for from has have in into is it its of on or s t that the their to was were will with your you about this those these which who whom whose when where how why what can could should would may might not no yes more most very just also than then'.split(' '));

function tokenize(s){
  return (s||'')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g,' ')
    .split(/\s+/)
    .filter(w => w && w.length > 1 && !STOP.has(w));
}

function chunkText(text, target=1200){
  const chunks=[]; let buf=''; const paras=text.split(/\n{2,}/);
  for(const p of paras){
    if((buf+'\n\n'+p).length<=target){ buf=buf?buf+'\n\n'+p:p; }
    else {
      if(buf) chunks.push(buf);
      if(p.length<=target) chunks.push(p);
      else {
        for(let i=0;i<p.length;i+=target) chunks.push(p.slice(i,i+target));
      }
      buf='';
    }
  }
  if(buf) chunks.push(buf);
  return chunks;
}

function selectRelevantChunks(question, text, k=5){
  const qTokens=tokenize(question); if(qTokens.length===0) return [];
  const chunks=chunkText(text,1400);
  const scored=chunks.map((c,idx)=>{
    const tks=tokenize(c); const set=new Set(tks);
    let score=0; qTokens.forEach(q=>{ if(set.has(q)) score+=1; });
    score+=Math.min(5,Math.floor(tks.length/120));
    return {idx,c,score};
  }).sort((a,b)=>b.score-a);
  return scored.slice(0,k).map(x=>x.c);
}

function detectIntent(q){
  const s=q.toLowerCase();
  if (/(summari[sz]e|tl;dr|overview)/.test(s)) return 'summarize';
  if (/(key points|highlights|bullets?|action items|takeaways)/.test(s)) return 'highlights';
  return 'qa';
}

// Phase 5.11: doc token match confidence
function ensureDocTokens() {
  if (!docContext.text) {
    docContext.tokens = null;
    return;
  }
  if (!docContext.tokens) {
    docContext.tokens = new Set(tokenize(docContext.text));
  }
}

function docMatchRatio(question) {
  const qTokens = tokenize(question);
  if (!qTokens.length || !docContext.text) return 0;
  ensureDocTokens();
  const set = docContext.tokens || new Set();
  let match = 0;
  for (const t of qTokens) {
    if (set.has(t)) match++;
  }
  return qTokens.length ? (match / qTokens.length) : 0;
}


// --- OpenAI engines ---
async function openAIDocAnswer(question, text) {
  const intent = detectIntent(question);
  const k = intent === 'qa' ? 6 : 12;

  const ctx = intent === 'qa'
    ? selectRelevantChunks(question, text, k).join('\n\n')
    : chunkText(text, 1400).slice(0, k).join('\n\n');

  const sys = `You are HaloAI. Answer ONLY using the provided document.
If the document does not contain the answer, say "I couldn't find this in the document."
Prefer concise bullets.`;

  const user = `Document: """\n${ctx}\n"""\n\nTask: ${
    intent === 'summarize'
      ? 'Provide a concise summary.'
      : intent === 'highlights'
        ? 'List the key points / action items as bullets.'
        : `Answer the question strictly from the document: ${question}`
  }`;

  // --- CLOUD-ONLY OpenAI call ---
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.FALLBACK_MODEL || 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 600,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user }
        ]
      })
    });

    const txt = await r.text();
    let json = null;

    try {
      json = JSON.parse(txt);
    } catch {
      send('log', `[OpenAI raw] ${txt}`);
    }

    // OpenAI error handling
    if (json?.error?.message) {
      send('log', `[OpenAI Error] ${json.error.message}`);
      return `I couldn't find this in the document.`;
    }

    const out = json?.choices?.[0]?.message?.content?.trim();
    if (out) return out;

  } catch (err) {
    send('log', `[OpenAI Exception] ${err.message}`);
  }

  // --- CLOUD FALLBACK ---
  // Brave summary first
  try {
    const brave = await braveWebSummary(question, 4);
    if (brave) return brave;
  } catch (e) {
    send('log', `[Brave fallback error] ${e.message}`);
  }

  // Router fallback (Bing/SerpAPI/PSE)
  try {
    const results = await cachedSmartSearch(question, {
      maxResults: 4,
      log: (line) => send('log', line)
    });

    if (results?.length) {
      const parts = results.map(r => {
        const base = r.snippet?.trim() || r.title?.trim() || '';
        const src = r.url ? ` (${r.url})` : '';
        return `${base}${src}`;
      }).filter(Boolean);

      if (parts.length) {
        return `From the web:\n• ${parts.join('\n• ')}`;
      }
    }
  } catch (e) {
    send('log', `[Router fallback error] ${e.message}`);
  }

  // Last fallback
  return `I couldn't find enough information to answer this from the document or the web.`;
}


async function openAIHybridAnswer(question, text) {
  const intent = detectIntent(question);
  const k = intent === 'qa' ? 6 : 10;

  // --- Document Context ---
  const docCtx = intent === 'qa'
    ? selectRelevantChunks(question, text, k).join('\n\n')
    : chunkText(text, 1400).slice(0, k).join('\n\n');

  // --- Web Search Context ---
  const results = await cachedSmartSearch(question, {
    maxResults: 4,
    log: (line) => send('log', line)
  });

  let webSnips = [];
  if (results && results.length) {
    for (const r of results) {
      const base = r.snippet || r.title || '';
      const sum = extractiveSummary(base, question, 3);
      if (sum) webSnips.push({ url: r.url, sum });
    }
  }

  const webCtx = webSnips
    .map((s, i) => `[${i + 1}] ${s.sum} (source: ${s.url})`)
    .join('\n');

  const sys = `You are HaloAI. Produce the BEST answer by combining the provided document with external knowledge snippets.
Rules:
- Be accurate and concise.
- Prefer the document when it clearly answers; otherwise enrich with the web snippets.
- If something conflicts, say so briefly.
- Use short bullets where helpful.`;

  const user = `Question: ${question}

Document context:
"""
${docCtx}
"""

Web snippets:
"""
${webCtx || '(no web snippets)'}
"""

Write one cohesive answer. If you use web info, reflect it clearly.`;


  // --- CLOUD-ONLY OpenAI ---
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.FALLBACK_MODEL || "gpt-4o-mini",
        temperature: 0.4,
        max_tokens: 700,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user }
        ]
      })
    });

    const txt = await r.text();
    let json = null;

    try {
      json = JSON.parse(txt);
    } catch {
      send("log", `[OpenAI raw] ${txt}`);
    }

    if (json?.error?.message) {
      send("log", `[OpenAI Error] ${json.error.message}`);
    } else {
      const out = json?.choices?.[0]?.message?.content?.trim();
      if (out) return out;
    }

  } catch (err) {
    send("log", `[OpenAI Exception] ${err.message}`);
  }

  // --------------------
  // CLOUD FALLBACK
  // --------------------

  // Brave summary
  try {
    const brave = await braveWebSummary(question, 5);
    if (brave) return brave;
  } catch (e) {
    send("log", `[Brave fallback error] ${e.message}`);
  }

  // Router (Bing / SerpAPI / Google PSE)
  try {
    const fallbackResults = await cachedSmartSearch(question, {
      maxResults: 4,
      log: (line) => send("log", line)
    });

    if (fallbackResults?.length) {
      const parts = fallbackResults.map(r => {
        const base = r.snippet?.trim() || r.title?.trim() || '';
        const src = r.url ? ` (${r.url})` : '';
        return `${base}${src}`;
      }).filter(Boolean);

      if (parts.length) {
        return `From the web:\n• ${parts.join("\n• ")}`;
      }
    }
  } catch (e) {
    send("log", `[Router fallback error] ${e.message}`);
  }

  // Absolute last fallback
  return `I couldn't find enough combined document + web information to answer this.`;
}


// Phase 5.12 — Doc-enrichment mode: doc-first then web
async function docEnrichAnswer(question, text) {
  const hasOpenAIKey = !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());

  // -------------------------------
  // PHASE A: DOC-FIRST (OpenAI only)
  // -------------------------------
  let docPart = '';

  if (hasOpenAIKey) {
    docPart = await openAIDocAnswer(question, text);
  } else {
    // If no OpenAI key → direct fallback
    const summary = extractiveSummary(text, question, 6);
    docPart = summary || `I couldn't find this in the document.`;
  }

  // -------------------------------
  // PHASE B: WEB ENRICHMENT
  // -------------------------------
  const results = await cachedSmartSearch(question, {
    maxResults: 4,
    log: (line) => send("log", line)
  });

  let webCtx = "";
  if (results && results.length) {
    webCtx = results
      .map((r) => r.snippet || r.title || "")
      .filter(Boolean)
      .join("\n\n");
  }

  const webPart = extractiveSummary(webCtx, question, 6);

  // -------------------------------
  // PHASE C: HYBRID FALLBACK
  // If doc lacks answer AND web lacks answer
  // -------------------------------
  const docEmpty =
    !docPart ||
    /couldn'?t find this in the document/i.test(docPart);

  if (docEmpty && !webPart) {
    // Try full hybrid answer (OpenAI only)
    try {
      const hybrid = await openAIHybridAnswer(question, text);
      if (hybrid) return hybrid;
    } catch (e) {
      send("log", `[Hybrid OpenAI error] ${e.message}`);
    }

    return `I couldn't find enough information in the document or the web to answer this.`;
  }

  // -------------------------------
  // PHASE D: COMBINE DOC + WEB
  // -------------------------------
  let out = "";

  if (docPart) {
    out += `From your document:\n${docPart.trim()}\n\n`;
  }

  if (webPart) {
    out += `From the web:\n${webPart.trim()}`;
  }

  return out.trim();
}


// --- Brave-only web summary helper (used by genericAnswer fallbacks) ---
async function braveWebSummary(userText, maxResults = 5) {
  if (!braveSearch) return null;
  const q = String(userText || '').trim();
  if (!q) return null;

  try {
    const results = await braveSearch.search(q, maxResults);
    if (!results || !results.length) return null;

    const bullets = results
      .map(r => {
        const title = (r.title || '').trim();
        const snippet = (r.snippet || '').trim();
        if (!title && !snippet) return '';
        if (title && snippet) return `${title} — ${snippet}`;
        return title || snippet;
      })
      .filter(Boolean);

    if (!bullets.length) return null;
    return `From the web (Brave):\n• ${bullets.join('\n• ')}`;
  } catch (e) {
    send('log', `[Brave:summary:error] ${e.message}`);
    return null;
  }
}


// --- Generic (no doc) ---
async function genericAnswer(userText){
  const mode = searchPrefs.mode || 'fastest';

  // Phase 8: cloud-only — removed all local LLM logic

  const hasOpenAIKey = !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());

  // "Cheapest" → avoid OpenAI even if key is present; rely on free web search
  if (!hasOpenAIKey || mode === 'cheapest') {
    const brave = await braveWebSummary(userText, 5);
    if (brave) return brave;

    const results = await cachedSmartSearch(userText, {
      maxResults: 5,
      log: (line) => send('log', line)
    });

    if (!results || !results.length){
      return `I couldn’t find enough public info for “${userText}”. Try rephrasing.`;
    }

    const bullets = results.map(r => {
      const base = (r.snippet && r.snippet.trim())
        ? r.snippet.trim()
        : (r.title || '').trim();
      const src = r.url ? ` (${r.url})` : '';
      return `${base}${src}`;
    });

    return `From the web:\n• ${bullets.join('\n• ')}`;
  }

  // "Fastest" and "Most accurate" → allow OpenAI
  try{
    const r = await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST',
      headers:{
        'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({
        model:process.env.FALLBACK_MODEL||'gpt-4o-mini',
        temperature:0.7,
        max_tokens:350,
        messages:[
          {role:'system',content:'You are HaloAI. Provide clear, direct answers.'},
          {role:'user',content:userText}
        ]
      })
    });
    const txt = await r.text(); let json;
    try{ json=JSON.parse(txt); }catch{ send('log',`[OpenAI raw] ${txt}`); }
    if (json?.error?.message){ send('log',`[OpenAI Error] ${json.error.message}`); }
    const out = json?.choices?.[0]?.message?.content?.trim();
    if (out) return out;
  }catch(e){
    send('log', `[OpenAI Exception] ${e.message}`);
  }

  // Fallback → router → Brave
  const results = await cachedSmartSearch(userText, {
    maxResults: 4,
    log: (line) => send('log', line)
  });
  if (results && results.length) {
    const bullets = results.map(r => {
      const base = (r.snippet && r.snippet.trim())
        ? r.snippet.trim()
        : (r.title || '').trim();
      const src = r.url ? ` (${r.url})` : '';
      return `${base}${src}`;
    });
    return `From the web:\n• ${bullets.join('\n• ')}`;
  }

  const brave = await braveWebSummary(userText, 5);
  if (brave) return brave;

  return `I couldn’t find enough public info for “${userText}”.`;
}


// --- Router ---
// ---------------- CLOUD-ONLY ROUTER (Phase 8) ----------------
async function answer(userText) {
  const q = (userText || '').trim();
  send("log", `[answer()] received prompt: ${q}`);
  console.log("[answer()] received prompt:", q);

  if (!q) return '';

  // --------------------------------------
  // 1) GROQ FAST ANSWER (PRIMARY ENGINE)
  // --------------------------------------
  try {
    const fast = await groqFastAnswer(q);

    // More than 2 chars ensures real content (prevents "OK" / blanks)
    if (fast && typeof fast === "string" && fast.trim().length > 2) {
      send("log", "[Groq] Primary engine succeeded.");
      return fast.trim();
    } else {
      send("log", "[Groq] Returned empty/short content, skipping.");
    }
  } catch (err) {
    send("log", `[Groq fast error] ${err.message}`);
  }

  // --------------------------------------
  // 2) BRAVE FALLBACK (SECOND)
  // --------------------------------------
  try {
    const brave = await braveWebSummary(q, 5);

    if (brave && brave.trim().length > 0) {
      send("log", "[Brave] Fallback summary succeeded.");
      return brave;
    }
  } catch (err) {
    send("log", `[Brave error] ${err.message}`);
  }

  // --------------------------------------
  // 3) ROUTED WEB SEARCH (THIRD FALLBACK)
  // --------------------------------------
  try {
    const results = await cachedSmartSearch(q, {
      maxResults: 5,
      log: (line) => send("log", line)
    });

    if (results && results.length) {
      send("log", "[Router] Routed web search succeeded.");

      const bullets = results
        .map(r => {
          const base = r.snippet?.trim() || r.title?.trim() || "";
          const src = r.url ? ` (${r.url})` : "";
          return `${base}${src}`;
        })
        .filter(Boolean);

      if (bullets.length) {
        return `From the web:\n• ${bullets.join("\n• ")}`;
      }
    }
  } catch (err) {
    send("log", `[Router error] ${err.message}`);
  }

  // --------------------------------------
  // 4) OPENAI FINAL RESCUE FALLBACK
  // --------------------------------------
  if (process.env.OPENAI_API_KEY) {
    try {
      send("log", "[OpenAI] Using final fallback.");

      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: process.env.FALLBACK_MODEL || "gpt-4o-mini",
          temperature: 0.5,
          max_tokens: 300,
          messages: [
            { role: "system", content: "You are HaloAI with cloud-only mode." },
            { role: "user", content: q }
          ]
        })
      });

      const txt = await r.text();
      let json;
      try {
        json = JSON.parse(txt);
      } catch {}

      const out = json?.choices?.[0]?.message?.content?.trim();
      if (out) return out;

    } catch (err) {
      send("log", `[OpenAI fallback error] ${err.message}`);
    }
  }

  // --------------------------------------
  // 5) ABSOLUTE LAST RETURN
  // --------------------------------------
  return `I couldn't find information for "${q}".`;
}



// --------------- Live / question classifiers (5.13) ---------------
function isQuestion(text) {
  const s = String(text || '');
  return /(\?|^\s*(who|what|why|when|where|which|how|can|could|should|would)\b|please\b)/i.test(s);
}

function isWebHeavyTopic(text) {
  const s = String(text || '').toLowerCase();
  return /\b(stock|stocks|share price|price today|quote|ticker|earnings|revenue|guidance|forecast|weather|temperature|rain|storm|bitcoin|btc|crypto|ethereum|eth|solana|sol|coinbase|spy|qqq|tsla|aapl|nifty|sensex|nasdaq|dow|news|headline)\b/.test(s);
}

// Live questions: skip doc path, auto-route to web/generic
async function answerLiveQuestion(text) {
  const q = String(text || '').trim();
  if (!q) return '';

  // If finance/markets/weather/news → web-only via genericAnswer
  if (isWebHeavyTopic(q)) {
    // genericAnswer already respects searchPrefs + smartSearch/OpenAI
    return await genericAnswer(q);
  }

  // For now, all live questions bypass doc context (5.13 requirement)
  return await genericAnswer(q);
}

// ---------------- Paths / Recorder ----------------
function tmpDir(){
  const dir=path.join(os.tmpdir(),'haloai');
  if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
  return dir;
}
function tmpWav(idx){ return path.join(tmpDir(), `chunk_${idx}.wav`); }

// Use device + gain from existing config (no UI change needed)
function recordWithSox(outfile, ms, onDone, device = 'default', gainDb = '0'){
  const seconds = Math.max(1, Math.round(ms/1000));
  const devArg = (device && device !== 'default') ? device : 'default';
  const args = [
    '-q','-t','waveaudio', devArg,
    '-r','16000','-b','16','-c','1',
    outfile,
    // No silence detection; fixed chunk, slight gain
    'trim','0', String(seconds),
    'gain', String(gainDb || '10')
  ];

  send('log', `[sox] ${args.join(' ')}`);
  try{
    const child=spawn('sox',args,{windowsHide:true});
    child.on('error',e=>send('log',`[sox:error] ${e.message}`));
    child.on('close',()=>{ try{ onDone&&onDone(); }catch{} });
  }catch(e){
    send('log',`[sox:spawn:failed] ${e.message}`);
    try{ onDone&&onDone(e);}catch{}
  }
}

// ---------------- Live + Companion pipeline ----------------
let live={on:false, idx:0, transcript:''};
let recConfig={device:'default', gainDb:'0', chunkMs:1200};

// Live Companion state
const companion = {
  enabled: true,
  intervalMs: 12000,
  timer: null,
  lastLen: 0,
  lastUpdateAt: 0
};

// Compose a rolling “Live Companion” update from transcript
async function generateCompanionUpdate(kind = 'rolling') {
  const tx = live.transcript.trim();
  if (!tx) return;

  const sys = `You are HaloAI Live Companion. Listen to a meeting/conversation transcript and provide:
- A 2–4 line concise summary (no fluff)
- Up to 5 action items with owners if mentioned
- Helpful suggested prompts the user could say to you next
Keep it short. If nothing new since last update, say "No material changes."`;

  const user = `Transcript (${kind}):\n"""${tx.slice(-6000)}"""`;

  let out = '';

  // Phase 8 — CLOUD ONLY (no local LLM)
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()) {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: process.env.FALLBACK_MODEL || 'gpt-4o-mini',
          temperature: 0.3,
          max_tokens: 400,
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: user }
          ]
        })
      });

      const j = await r.json();
      out = j?.choices?.[0]?.message?.content?.trim() || '';
    } catch (e) {
      send('log', `[Companion(OpenAI) error] ${e.message}`);
    }
  }

  // Fallback summary (if OpenAI fails)
  if (!out) {
    const summary = extractiveSummary(tx, '', 6);
    const bullets = summary
      .split(/(?<=[.!?])\s+/)
      .slice(0, 5)
      .map(s => `• ${s.trim()}`)
      .join('\n');

    out = `Summary:\n${summary}\n\nAction Items (draft):\n${bullets || '• (none)'}\n\nTry asking:\n• “What are the top 3 decisions?”\n• “Any blockers and owners?”`;
  }

  send('live:answer', out);
  companion.lastLen = tx.length;
  companion.lastUpdateAt = Date.now();
}


function startCompanionTimer(){
  if (!companion.enabled) return;
  stopCompanionTimer();
  companion.timer = setInterval(async () => {
    const txLen = live.transcript.length;
    if (txLen - companion.lastLen >= 60) {
      await generateCompanionUpdate('rolling');
    }
  }, companion.intervalMs);
}
function stopCompanionTimer(){
  if (companion.timer) { clearInterval(companion.timer); companion.timer = null; }
}

function startChunk(){
  const dMs=recConfig.chunkMs||1500;
  const thisIdx = live.idx;
  const outfile=tmpWav(thisIdx);
  const after=()=>{ 
    const size=fs.existsSync(outfile)?fs.statSync(outfile).size:0; 
    send('log', `[chunk] ${outfile} size=${size} bytes`);

    if (live.on){ live.idx = thisIdx + 1; setImmediate(startChunk); }

    (async()=>{
      try{
        const text=(await runWhisper(outfile))||'';
        if(text){
          live.transcript+=(live.transcript?'\n':'')+text;
          send('live:transcript',live.transcript);

          // Phase 5.13: only answer when chunk looks like a user question
          if (isQuestion(text)) {
            const a = await answerLiveQuestion(text);
            if(a) send('live:answer',a);
          }
        } else send('log','[whisper] (empty transcript)');
      }catch(e){ send('log', `[whisper:error] ${e.message}`); }
    })();
  };
  recordWithSox(outfile,dMs,after, recConfig.device, recConfig.gainDb);
}


// Mirror handlers for Companion overlay API (used by preload.js)
ipcMain.handle('companion:start', async()=>{
  if(live.on){ send('companion:state','on'); return {ok:true}; }
  live={on:true, idx:0, transcript:''};
  companion.lastLen = 0;
  companion.lastUpdateAt = 0;
  startCompanionTimer();
  startChunk();
  send('companion:state','on');
  send('live:answer', '🔊 Live Companion is ON. I’ll drop concise updates every ~12 seconds and a final recap when you stop.');
  return {ok:true};
});
ipcMain.handle('companion:stop', async()=>{
  if(!live.on){ send('companion:state','off'); return {ok:true}; }
  live.on=false;
  stopCompanionTimer();
  await generateCompanionUpdate('final');
  send('companion:state','off');
  return {ok:true};
});
ipcMain.handle('live:start', async()=>{
  if(live.on) return {ok:true};
  live={on:true, idx:0, transcript:''};
  companion.lastLen = 0;
  companion.lastUpdateAt = 0;
  startCompanionTimer();
  startChunk();
  send('companion:state','on');
  send('live:answer', '🔊 Live Companion is ON. I’ll drop concise updates every ~12 seconds and a final recap when you stop.');
  return {ok:true};
});
ipcMain.handle('live:stop', async()=>{
  live.on=false;
  stopCompanionTimer();
  await generateCompanionUpdate('final');
  return {ok:true};
});
// ... existing code above ...
// FAST transcription using Groq Whisper (Phase 7)
ipcMain.handle("groq:transcribe", async (_e, audioBuffer) => {
  try {
    const text = await groqWhisperTranscribe(audioBuffer);
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
// FAST answering using Groq LLaMA (Phase 7)
/*ipcMain.handle("groq:ask", async (_e, prompt) => {
  try {
    const ans = await groqFastAnswer(prompt);
    return { ok: true, answer: ans };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});*/

// Initialize Screen Reader (OCR) IPC
initScreenReader({
  ipcMain,
  log: (msg) => send('log', msg)
});
ipcMain.on("ocr:image", async (event, imgBuffer) => {
  try {
    const { data: { text }} = await Tesseract.recognize(imgBuffer, "eng");
    send("ocr:text", text);
  } catch (err) {
    send("ocr:text", "OCR Error: " + err.message);
  }
});



// ---------------- File mode ----------------
ipcMain.handle('pick:audio', async()=>{
  const {canceled,filePaths}=await dialog.showOpenDialog({
    properties:['openFile'],
    filters:[{name:'Audio',extensions:['wav','mp3','m4a','ogg']}]
  });
  return canceled?null:filePaths[0];
});
ipcMain.handle('whisper:transcribe', async(_e, p)=>{
  try{ const t=await runWhisper(p); return {code:0, output:t}; }
  catch(e){ send('log', `[error] ${e.message}`); return {code:-1, output:''}; }
});

// ---------------- Config ----------------
ipcMain.handle('sox:devices', async()=>({items:[], selected:recConfig.device||'default'}));
ipcMain.handle('rec:getConfig', async()=>recConfig);
ipcMain.handle('rec:setConfig', async(_e,cfg)=>{
  if(cfg?.device!==undefined) recConfig.device=String(cfg.device||'default');
  if(cfg?.gainDb!==undefined) recConfig.gainDb=String(cfg.gainDb||'0');
  if(cfg?.chunkMs!==undefined){
    const v=Math.max(500,Math.min(4000,Number(cfg.chunkMs)||1500));
    recConfig.chunkMs=v;
  }
  send('log', `[rec] updated: device=${recConfig.device}, gain=${recConfig.gainDb}dB, chunkMs=${recConfig.chunkMs}`);
  return {ok:true, recConfig};
});

// ---------------- Chat + Doc ingest ----------------
ipcMain.handle('chat:ask', async(_e, text)=>{
  console.log("[Main → QA] Sending to QA:", text);
const out = await answer(text);
console.log("[QA → Main] Returned:", out);
return out;

});
ipcMain.handle('doc:ingestText', async(_e,p)=>{
  const name=(p?.name||'document.txt').toString();
  const raw=(p?.text||'').toString();
  const text=raw.replace(/\u0000/g,'').slice(0,200000);
  docContext={name,text,tokens:null};
  send('log', `[doc] loaded text: ${name}, ${text.length} chars`);
  return {ok:true, name, chars:text.length};
});
ipcMain.handle('doc:ingestBinary', async(_e,p)=>{
  const name=(p?.name||'document.bin').toString();
  const bytes=p?.bytes;
  const mime=(p?.mime||'').toString();
  if(!bytes||!Array.isArray(bytes)) return {ok:false,error:'No bytes'};
  if (name.toLowerCase().endsWith('.pdf')||mime==='application/pdf'){
    try{
      if(!pdfParse){
        try{ pdfParse=require('pdf-parse'); }
        catch{
          const msg='[doc] PDF support not installed. Run: npm i pdf-parse';
          send('log',msg); send('live:answer',msg);
          return {ok:false,error:'Missing pdf-parse'};
        }
      }
      const buff=Buffer.from(bytes);
      const data=await pdfParse(buff);
      const text=(data.text||'').slice(0,200000);
      docContext={name,text,tokens:null};
      send('log', `[doc] loaded PDF: ${name}, ${text.length} chars`);
      return {ok:true, name, chars:text.length, type:'pdf'};
    }catch(e){
      const msg=`[doc] PDF load error: ${e.message}`;
      send('log',msg); send('live:answer',msg);
      return {ok:false,error:e.message};
    }
  }
  return {ok:false, error:'Unsupported binary type. Use PDF or text formats.'};
});
ipcMain.handle('doc:clear', async()=>{
  docContext={name:'',text:'',tokens:null};
  return {ok:true};
});
ipcMain.handle('doc:setUse', async(_e, flag)=>{
  useDoc = !!flag;
  return { ok:true, useDoc };
});

// Phase 5.12: backend doc-enrich toggle
ipcMain.handle('doc:enrich:set', async(_e, flag)=>{
  docEnrich = !!flag;
  send('log', `[doc] enrich=${docEnrich ? 'ON' : 'OFF'}`);
  return { ok:true, docEnrich };
});

// Phase 5.15: search preferences
ipcMain.handle('searchPrefs:set', async(_e, prefs)=>{
  const mode = (prefs && prefs.mode || '').toString().toLowerCase();
  const allowed = ['fastest','cheapest','accurate','local'];
  if (allowed.includes(mode)) {
    searchPrefs.mode = mode;
  }
  send('log', `[search] mode=${searchPrefs.mode}`);
  return { ok:true, mode: searchPrefs.mode };
});

// (Web+ backend toggle kept; UI removed)
ipcMain.handle('webplus:set', async(_e, flag)=>{
  webPlus = !!flag;
  send('log', `[Web+] ${webPlus?'enabled':'disabled'}`);
  return { ok:true, webPlus };
});

// NEW: expose provider stats to the renderer for the API usage panel
ipcMain.handle('search:stats', async () => {
  try {
    const stats = typeof getProviderStats === 'function' ? getProviderStats() : {};
    return { ok: true, stats };
  } catch (e) {
    send('log', `[search:stats:error] ${e.message}`);
    return { ok: false, error: e.message };
  }
});
ipcMain.handle("screenread:start", async () => {
  try {
    exec("explorer.exe ms-screenclip:");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("screenread:getClipboardImage", async () => {
  try {
    const img = clipboard.readImage();

    if (img.isEmpty()) {
      return { ok: false, error: "No image in clipboard" };
    }

    const buffer = img.toPNG();
    return { ok: true, img: buffer };

  } catch (e) {
    return { ok: false, error: e.message };
  }
});


// ---------------- Window controls / env ----------------
ipcMain.handle('window:minimize', ()=>{ if(win && !win.isDestroyed()) win.minimize(); });
ipcMain.handle('window:maximize', ()=>{ if(!win||win.isDestroyed()) return; if(win.isMaximized()) win.unmaximize(); else win.maximize(); });
ipcMain.handle('window:close', ()=>app.exit(0));
ipcMain.handle('window:restore', () => {
  if (win && win.isMinimized()) win.restore();
});
ipcMain.handle('env:get', ()=>({
  APP_NAME: process.env.APP_NAME || 'HaloAI',
  OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
  FALLBACK_MODEL: process.env.FALLBACK_MODEL || 'gpt-4o-mini'
}));
