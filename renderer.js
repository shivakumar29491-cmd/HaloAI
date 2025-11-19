// ------------------ Helpers ------------------
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

// Force textarea as the single transcript sink
const transcriptSink = document.getElementById('liveTranscript');

// --- Harden transcript as display-only (no typing/paste/drop) ---
function hardenTranscript(el) {
  if (!el) return;
  el.readOnly = true;
  el.setAttribute('aria-readonly', 'true');
  el.setAttribute('contenteditable', 'false');
  el.setAttribute('spellcheck', 'false');
  el.setAttribute('autocomplete', 'off');
  el.setAttribute('autocorrect', 'off');
  el.setAttribute('autocapitalize', 'off');

  el.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    const allowNav = ['arrowleft','arrowright','arrowup','arrowdown','home','end','pageup','pagedown','tab','escape'].includes(k);
    const allowCopyAll = (e.ctrlKey || e.metaKey) && (k === 'c' || k === 'a');
    if (!(allowNav || allowCopyAll)) e.preventDefault();
  });
  el.addEventListener('paste', (e) => e.preventDefault());
  el.addEventListener('drop',  (e) => e.preventDefault());
  el.addEventListener('cut',   (e) => e.preventDefault());
}

// call it once
hardenTranscript(transcriptSink);

// Make transcript display-only (defensive)
if (transcriptSink) {
  if ('readOnly' in transcriptSink) transcriptSink.readOnly = true;
  transcriptSink.setAttribute('contenteditable', 'false');
}

// --- Unified transcript helpers (used for both typed + spoken lines) ---
function _appendTranscript(line, cls) {
  if (!transcriptSink) return;
  const s = String(line || '').trim();
  if (!s) return;

  if ('value' in transcriptSink) {
    const ta = transcriptSink;
    const needsSep = ta.value && !ta.value.endsWith('\n');
    ta.value += (needsSep ? '\n' : '') + s + '\n';
    ta.scrollTop = ta.scrollHeight;
  } else {
    const div = document.createElement('div');
    div.className = cls || 'bubble me';
    div.textContent = s;
    transcriptSink.appendChild(div);
    transcriptSink.scrollTop = transcriptSink.scrollHeight;
  }
}
// --- Answer log helper (Phase 6.3) ---
function appendAnswerBlock(text) {
  if (!liveAnswer) return;

  const s = String(text || '').trim();
  if (!s) return;

  const block = document.createElement('div');
  block.className = 'answer-block';
  block.textContent = s;

  const sep = document.createElement('div');
  sep.className = 'answer-separator';
  sep.textContent = '--- suggestion ended ---';

  liveAnswer.appendChild(block);
  liveAnswer.appendChild(sep);

  // Auto-scroll to bottom
  liveAnswer.scrollTop = liveAnswer.scrollHeight;
   // tell main process so it can update pop-out + history
  try { window.electron?.invoke('answer:push', s); } catch {}
}

// De-dupe helper to avoid double lines (from IPC + companion overlap)
let __lastLine = '';
function _appendDedup(prefix, text, cls) {
  const body = String(text || '').trim();
  if (!body) return;
  const line = prefix ? `${prefix} ${body}` : body;
  if (line === __lastLine) return;
  __lastLine = line;
  _appendTranscript(line, cls);
}

function pickFirst(...els) { return els.find(Boolean) || null; }

function appendLog(line) {
  const liveLog = $('#liveLog');
  if (!liveLog) return;
  const s = String(line ?? '');
  liveLog.value += (s.endsWith('\n') ? s : s + '\n');
  liveLog.scrollTop = liveLog.scrollHeight;
}

// ------------------ API usage panel helpers ------------------
const apiStats = {};

function renderApiUsagePanel(){
  const panel = $('#apiUsagePanel');
  if (!panel) return;
  const statsArr = Object.values(apiStats);
  if (!statsArr.length){
    panel.innerHTML = '<div class="api-usage-empty">No API calls yet in this session.</div>';
    return;
  }
  statsArr.sort((a,b) => a.provider.localeCompare(b.provider));
  panel.innerHTML = statsArr.map(s => `
    <div class="api-usage-row">
      <div class="api-usage-name">${s.provider}</div>
      <div class="api-usage-metrics">
        <span class="api-usage-pill">Calls: ${s.calls}</span>
        ${s.limit != null && s.remaining != null ? `<span class="api-usage-pill">Remaining: ${s.remaining}/${s.limit}</span>` : ''}
        ${s.lastMs != null ? `<span class="api-usage-pill">Last: ${s.lastMs} ms</span>` : ''}
        ${s.lastKind ? `<span class="api-usage-pill kind">${s.lastKind}</span>` : ''}
        ${s.lastAt ? `<span class="api-usage-pill time">${s.lastAt}</span>` : ''}
      </div>
    </div>
  `).join('');
}

// NEW: periodically pull provider stats from main.js (searchRouter.getProviderStats)
async function refreshApiUsageFromBackend(){
  if (!window.electron?.invoke) return;
  try{
    const res = await window.electron.invoke('search:stats');
    if (!res || !res.ok || !res.stats) return;
    const stats = res.stats;
    Object.entries(stats).forEach(([provider, s]) => {
      if (!apiStats[provider]) {
        apiStats[provider] = {
          provider,
          calls: 0,
          lastKind: '',
          lastMs: null,
          lastAt: '',
          limit: null,
          remaining: null
        };
      }
      const st = apiStats[provider];
      // Prefer backend "used" count but don't overwrite if it's missing
      if (s && typeof s.used === 'number') {
        st.calls = s.used;
      }
    });
    renderApiUsagePanel();
  }catch(e){
    // silent fail — we don't want to spam the log for polling errors
  }
}

function handleApiLogLine(line){
  const raw = String(line || '');
  if (!/^\s*\[api\]/i.test(raw)) return;
  const s = raw.replace(/^\s*\[api\]\s*/i,'').trim();
  const parts = s.split(/\s+/);
  const kv = {};
  for (const tok of parts){
    const idx = tok.indexOf('=');
    if (idx <= 0) continue;
    const k = tok.slice(0, idx).toLowerCase();
    let v = tok.slice(idx+1);
    v = v.replace(/^"+|"+$/g, '');
    kv[k] = v;
  }
  const provider = kv.provider || 'unknown';
  if (!apiStats[provider]){
    apiStats[provider] = {
      provider,
      calls: 0,
      lastKind: '',
      lastMs: null,
      lastAt: '',
      limit: null,
      remaining: null
    };
  }
  const st = apiStats[provider];
  st.calls += 1;
  if (kv.kind) st.lastKind = kv.kind;
  if (kv.ms && !Number.isNaN(Number(kv.ms))) st.lastMs = Number(kv.ms);
  if (kv.limit && !Number.isNaN(Number(kv.limit))) st.limit = Number(kv.limit);
  if (kv.remaining && !Number.isNaN(Number(kv.remaining))) st.remaining = Number(kv.remaining);
  try{
    const now = new Date();
    st.lastAt = now.toLocaleTimeString();
  }catch{}
  renderApiUsagePanel();
}

// ------------------ Doc toggle + DocEnrich wiring ------------------
const docToggle       = $('#docToggle');
const docEnrichToggle = $('#docEnrichToggle');
const searchModeSelect = $('#searchMode');

function setDocToggle(on) {
  if (!docToggle) return;
  const active = !!on;
  docToggle.classList.toggle('active', active);
  docToggle.textContent = active ? 'Doc • ON' : 'Doc';
}

function setDocEnrichToggle(on) {
  if (!docEnrichToggle) return;
  const active = !!on;
  docEnrichToggle.classList.toggle('active', active);
  docEnrichToggle.textContent = active ? 'Enrich • ON' : 'Enrich';
}

// If the button exists, wire click → backend doc:setUse
on(docToggle, 'click', async () => {
  if (!docToggle) return;
  const next = !docToggle.classList.contains('active');
  setDocToggle(next);
  try {
    const res = await window.electron.invoke('doc:setUse', next);
    appendLog(`[doc] mode ${res?.useDoc ? 'ON' : 'OFF'}`);
  } catch (e) {
    appendLog(`[doc] toggle error: ${e.message}`);
  }
});

// DocEnrich toggle → backend doc:enrich:set
on(docEnrichToggle, 'click', async () => {
  if (!docEnrichToggle) return;
  const next = !docEnrichToggle.classList.contains('active');
  setDocEnrichToggle(next);
  try {
    const res = await window.electron.invoke('doc:enrich:set', next);
    appendLog(`[doc] enrich ${res?.docEnrich ? 'ON' : 'OFF'}`);
  } catch (e) {
    appendLog(`[doc] enrich toggle error: ${e.message}`);
  }
});

// Search mode dropdown → backend searchPrefs:set
on(searchModeSelect, 'change', async () => {
  if (!searchModeSelect) return;
  const mode = searchModeSelect.value || 'fastest';
  try {
    const res = await window.electron.invoke('searchPrefs:set', { mode });
    appendLog(`[search] mode=${res?.mode || mode}`);
  } catch (e) {
    appendLog(`[search] prefs error: ${e.message}`);
  }
});

function setState(txt) {
  const el = $('#liveState');
  if (el) {
    el.textContent = txt;
    const on = /listening|starting/i.test(String(txt || ''));
    el.classList.toggle('pulsing', on);
  }
}

// Drop “banner/status” lines from Answer/Companion sinks
function isStatusyBanner(t) {
  if (!t) return false;
  const s = String(t);
  return (
    /^\s*🔊\s*Live Companion is ON/i.test(s) ||
    /^\s*No material changes\./i.test(s) ||
    /^\s*(Summary:|Action Items|From the web:)/i.test(s) ||
    /\b(PDF support not installed|PDF load error|Web\+\s+(enabled|disabled))\b/i.test(s) ||
    /^\s*Tip:\s+/i.test(s) ||
    /^\s*Status:\s+/i.test(s)
  );
}

// ------------------ Tabs ------------------
(function wireTabs(){
  const tabs = $$('.tab');
  const panels = {
    live: $('#tab-live'),
    pre:  $('#tab-pre'),
    logs: $('#tab-logs')
  };
  tabs.forEach(t => on(t, 'click', () => {
    tabs.forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    Object.values(panels).forEach(p => p && p.classList.remove('show'));
    const key = t.dataset.tab;
    const target = panels[key] || panels.live;
    if (target) target.classList.add('show');
  }));
})();

// ------------------ Window controls ------------------
on($('#btn-min'), 'click', () => window.windowCtl?.minimize());
on($('#btn-max'), 'click', () => window.windowCtl?.maximize());
on($('#btn-close'), 'click', () => window.windowCtl?.close());

// ------------------ Live controls ------------------
const btnStart = pickFirst($('#startBtn'), $('[data-action="start"]'), $('[title="Start"]'));
const btnStop  = pickFirst($('#stopBtn'),  $('[data-action="stop"]'),  $('[title="Stop"]'));

const liveTranscript = $('#liveTranscript') || document.querySelector('#tab-live textarea');
const liveAnswer      = $('#liveAnswer');
const liveStatus      = $('#liveStatus');
const companionToggle = $('#companionToggle');
const transcriptEl    = $('#liveTranscript');
const answerEl        = $('#liveAnswer');
const screenReadBtn = $('#screenReadBtn');
const clearAnswer     = $('#clearAnswer');
const popoutAnswer    = $('#popoutAnswer');



// --- Single Transcript helpers ---
let _txSeenLen = 0;
let _txLastLine = '';

function _ensureTrailingNewline(el){
  if (el && !el.value.endsWith('\n')) el.value += '\n';
}

function appendTranscriptLine(line) {
  if (!liveTranscript) return;
  const s = String(line ?? '').trim();
  if (!s || s === _txLastLine) return;
  _txLastLine = s;
  liveTranscript.value += (liveTranscript.value ? '\n' : '') + s;
  _ensureTrailingNewline(liveTranscript);
  liveTranscript.scrollTop = liveTranscript.scrollHeight;
}

function appendTranscriptChunk(chunk){
  const parts = String(chunk || '').split(/\r?\n+/).map(p => p.trim()).filter(Boolean);
  parts.forEach(p => appendTranscriptLine(`🎙 ${p}`));
}

function setTranscriptText(s) {
  if (liveTranscript) {
    liveTranscript.value = (s || '');
    _ensureTrailingNewline(liveTranscript);
    liveTranscript.scrollTop = liveTranscript.scrollHeight;
  }
}
on(screenReadBtn, 'click', async () => {
  if (!window.electron?.invoke) return;

  try {
    setState('screen: capturing…');
    const res = await window.electron.invoke('screen:readOnce');

    if (!res || !res.ok) {
      appendLog(`[screen] error: ${res && res.error ? res.error : 'unknown error'}`);
      setState('error');
      return;
    }

    const text = (res.text || '').trim();
    if (!text) {
      appendLog('[screen] no text detected by OCR');
      setState('idle');
      return;
    }

    // 1) Show OCR text inside the Transcript box
    if (liveTranscript) {
      const existing = (liveTranscript.value || '').trim();
      const prefix = '[SCREEN OCR]\n';
      liveTranscript.value = (existing ? existing + '\n\n' : '') + prefix + text;
      liveTranscript.scrollTop = liveTranscript.scrollHeight;
    }

    // 2) Load OCR text as a temporary "document" for later questions
    try {
      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const name = `ScreenCapture-${ts}.txt`;
      await window.electron.invoke('doc:ingestText', { name, text });
    } catch (e) {
      appendLog(`[screen] doc ingest error: ${e.message}`);
    }

    // 3) Ask the QA engine to summarize + suggest follow-up questions
    try {
      const prompt =
        `Here is text captured from my screen:\n` +
        `"""\n${text.slice(0, 4000)}\n"""\n\n` +
        `1) Summarize it in clear bullet points.\n` +
        `2) Suggest 3 helpful follow-up questions I could ask about this content.`;

      const answer = await window.electron.invoke('chat:ask', prompt);
if (answer && !isStatusyBanner(answer)) {
  appendAnswerBlock(answer);
}

    } catch (e) {
      appendLog(`[screen] QA error: ${e.message}`);
    }

    setState('idle');
  } catch (err) {
    appendLog(`[screen] unexpected error: ${err.message || err}`);
    setState('error');
  }
});

// Start/Stop
on(btnStart, 'click', async () => {
  setState('starting…');
  try { await pushConfig(); } catch {}
  try {
    const r = await window.electron?.invoke('live:start');
    if (r?.ok) {
      _txSeenLen = 0;
      _txLastLine = '';
      setState('listening');
      setTranscriptText('Listening…');
    } else {
      setState('error');
    }
    document.body.classList.add('companion-on');
    btnStart?.classList.add('recording');
  } catch (e) {
    appendLog(`[ui] live:start error: ${e.message}`);
    setState('error');
  }
});

on(btnStop, 'click', async () => {
  try { await window.electron?.invoke('live:stop'); } catch {}
  setState('idle');
  document.body.classList.remove('companion-on');
  btnStart?.classList.remove('recording');
});

// Backend → UI
window.electron?.on('log', (t) => { appendLog(t); handleApiLogLine(t); });

// Live speech -> Transcript (append lines with 🎙 prefix)
window.electron?.on('live:transcript', (t) => {
  if (!transcriptSink) return;
  const parts = String(t || '').split(/\r?\n+/).map(x => x.trim()).filter(Boolean);
  parts.forEach(p => _appendDedup('🎙', p, 'bubble tx'));
});

// AI answers -> Answer box
window.electron?.on('live:answer', (t) => {
  if (!t) return;
  if (isStatusyBanner(t)) {
    try { setState('listening'); } catch {}
    return;
  }
  appendAnswerBlock(t);
});


// ------------------ Config / Devices (optional UI) ------------------
const selDevice  = $('#soxDevice');
const inpGain    = $('#gainDb');
const inpChunk   = $('#chunkMs');
const btnRefresh = $('#refreshDevices');
const btnTest    = $('#testMic');

async function listDevices() {
  try {
    const r = await window.electron.invoke('sox:devices');
    if (!r?.items || !selDevice) return;
    selDevice.innerHTML = '';
    r.items.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.label || d.id;
      if (r.selected && r.selected === d.id) opt.selected = true;
      selDevice.appendChild(opt);
    });
  } catch (e) {
    appendLog(`[ui] sox:devices error: ${e.message}`);
  }
}

async function loadConfigToUI() {
  try {
    const cfg = await window.electron.invoke('rec:getConfig');
    if (inpGain && cfg?.gainDb !== undefined) inpGain.value = cfg.gainDb;
    if (inpChunk && cfg?.chunkMs !== undefined) inpChunk.value = String(cfg.chunkMs);
    if (selDevice && cfg?.device) selDevice.value = cfg.device;
  } catch {}
}

async function pushConfig() {
  if (!selDevice && !inpGain && !inpChunk) return;
  const cfg = {
    device: selDevice?.value ?? 'default',
    gainDb: inpGain?.value ?? '0',
    chunkMs: Math.max(500, Number(inpChunk?.value || 1500))
  };
  try { await window.electron.invoke('rec:setConfig', cfg); }
  catch (e) { appendLog(`[ui] rec:setConfig error: ${e.message}`); }
}

on(btnRefresh, 'click', async () => { await listDevices(); appendLog('[ui] refreshed input device list'); });
on(selDevice, 'change', async () => { await pushConfig(); appendLog(`[ui] set device=${selDevice.value}`); });
on(inpGain, 'change', async () => { await pushConfig(); appendLog(`[ui] set gain=${inpGain.value}dB`); });
on(inpChunk, 'change', async () => { await pushConfig(); appendLog(`[ui] set chunkMs=${inpChunk.value}`); });
on(btnTest, 'click', async () => {
  await pushConfig();
  appendLog('[test] recording 3s…');
  try {
    const r = await window.electron.invoke('rec:test');
    if (r?.file) appendLog(`[test] file=${r.file} size=${r.size} bytes`);
    if (r?.transcript && liveTranscript) {
      liveTranscript.value = r.transcript;
      _ensureTrailingNewline(liveTranscript);
      liveTranscript.scrollTop = liveTranscript.scrollHeight;
    }
  } catch {}
});

// --- Live Companion UX wiring ---
if (window.companion) {
  on(companionToggle, 'click', async () => {
    const isOn = companionToggle.classList.contains('active');
    try {
      if (isOn) { await window.companion.stop(); }
      else      { await window.companion.start(); }
    } catch (e) { appendLog(`[companion] toggle error: ${e.message}`); }
  });

  window.companion.onState((s) => {
    const onState = s === 'on';
    if (onState) {
      setState('listening');
      document.body.classList.add('companion-on');
      companionToggle?.classList.add('active','pulsing');
      companionToggle.textContent = 'Companion • ON';
    } else {
      setState('');
      document.body.classList.remove('companion-on');
      companionToggle?.classList.remove('active','pulsing');
      companionToggle.textContent = 'Companion';
      if (liveTranscript && liveTranscript.value.trim() === 'Listening…') {
        liveTranscript.value = '';
      }
    }
  });

  window.companion.onTranscript((t) => {
    const parts = String(t || '').split(/\r?\n+/).map(x => x.trim()).filter(Boolean);
    parts.forEach(p => _appendDedup('🎙', p, 'bubble tx'));
  });

  window.companion.onSuggestion((s) => {
  const msg = (typeof s === 'string') ? s : (s?.message || '');
  if (!msg || isStatusyBanner(msg)) return;
  appendAnswerBlock(msg);
});

}

// ------------------ Chat + Doc QA (file ingest + chat-to-answer) ------------------
const chatInput = $('#chatInput');
const chatSend  = $('#chatSend');
const fileBtn   = $('#fileBtn');
const docInput  = $('#docInput');
const docBadge  = $('#docBadge');

function showDocBadge(name, count) {
  if (!docBadge) return;
  const pretty = name.length > 28 ? '…' + name.slice(-28) : name;
  docBadge.textContent = `${pretty} • ${count} chars  ×`;
  docBadge.title = 'Click to remove';
  docBadge.classList.remove('hidden');
}
on(docBadge, 'click', async () => {
  await window.electron.invoke('doc:clear');
  docBadge?.classList.add('hidden');
  if (docBadge) docBadge.textContent = '';
});

on(chatSend, 'click', async () => {
  const val = chatInput?.value?.trim();
  if (!val) return;
  appendTranscriptLine(`You: ${val}`);
  chatInput.value = '';
  try {
    const ans = await window.electron.invoke('chat:ask', val);
    if (ans && !isStatusyBanner(ans)) {
      appendAnswerBlock(ans);
    }
  } catch (e) { appendLog(`[ui] chat:ask error: ${e.message}`); }
});

on(chatInput, 'keydown', (e) => { if (e.key === 'Enter') chatSend?.click(); });
on(fileBtn, 'click', () => docInput?.click());
on(docInput, 'change', async () => {
  const f = docInput?.files?.[0];
  if (!f) return;
  const name = f.name.toLowerCase();
  try {
    if (name.endsWith('.txt')) {
      const text = await f.text();
      const res = await window.electron.invoke('doc:ingestText', { name: f.name, text });
      if (res?.ok) showDocBadge(f.name, res.chars);
    } else if (name.endsWith('.pdf')) {
      const ab = await f.arrayBuffer();
      const bytes = Array.from(new Uint8Array(ab));
      const res = await window.electron.invoke('doc:ingestBinary', { name: f.name, bytes, mime: f.type || 'application/pdf' });
      if (res?.ok) showDocBadge(f.name, res.chars);
    }
  } finally {
    if (docInput) docInput.value = '';
  }
});

// ------------------ Pre-recorded ------------------
const pickAudioBtn  = $('#pickAudioBtn');
const transcribeBtn = $('#transcribeBtn');
const clearBtn      = $('#clearBtn');
const pickedPathEl  = $('#pickedPath');
const fileOutput    = $('#fileOutput');
let pickedPath = '';

on(pickAudioBtn, 'click', async () => {
  try {
    const p = await window.electron.invoke('pick:audio');
    if (p) { pickedPath = p; if (pickedPathEl) pickedPathEl.textContent = p; }
  } catch {}
});
on(transcribeBtn, 'click', async () => {
  if (!pickedPath) {
    if (fileOutput) fileOutput.value += 'Pick a file first.\n';
    return;
  }
  const r = await window.electron.invoke('whisper:transcribe', pickedPath);
  if (fileOutput) fileOutput.value += (r?.output || '') + '\n';
});
on(clearAnswer, 'click', () => {
  if (liveAnswer) liveAnswer.innerHTML = '';
  try { window.electron?.invoke('answer:clear'); } catch {}
});
on(popoutAnswer, 'click', async () => {
  try {
    await window.electron?.invoke('answerWindow:toggle');
  } catch (e) {
    appendLog(`[ui] answerWindow:toggle error: ${e.message}`);
  }
});


// ------------------ Init ------------------
(async function init(){
  if (selDevice || inpGain || inpChunk) {
    await listDevices();
    await loadConfigToUI();
  }
  if (!liveTranscript) {
    appendLog('[ui] WARNING: #liveTranscript not found in DOM');
  }
  // Default search mode
  if (searchModeSelect) {
    searchModeSelect.value = 'fastest';
  }
  // Periodically sync backend provider stats into the API usage panel
  refreshApiUsageFromBackend();
  setInterval(refreshApiUsageFromBackend, 10000);
})();
