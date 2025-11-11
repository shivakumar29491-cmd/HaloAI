// ------------------ Helpers ------------------
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const on = (el, ev, fn) => el && el.addEventListener(ev, fn);
// Force textarea as the single transcript sink
// Force textarea as the single transcript sink
const transcriptSink = document.getElementById('liveTranscript');
// --- Harden transcript as display-only (no typing/paste/drop) ---
function hardenTranscript(el) {
  if (!el) return;
  // native readOnly + accessibility
  el.readOnly = true;
  el.setAttribute('aria-readonly', 'true');
  el.setAttribute('contenteditable', 'false');
  el.setAttribute('spellcheck', 'false');
  el.setAttribute('autocomplete', 'off');
  el.setAttribute('autocorrect', 'off');
  el.setAttribute('autocapitalize', 'off');

  // block edits but allow Ctrl/Cmd+A/C and navigation keys
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
    ta.value += (needsSep ? '\n' : '') + s + '\n';   // ← always end with newline
    ta.scrollTop = ta.scrollHeight;
  } else {
    const div = document.createElement('div');
    div.className = cls || 'bubble me';
    div.textContent = s;
    transcriptSink.appendChild(div);
    transcriptSink.scrollTop = transcriptSink.scrollHeight;
  }
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

function setState(txt) {
  const el = $('#liveState');
  if (el) {
    el.textContent = txt;
    // pulse class when starting/listening
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
const answerEl        = $('#liveAnswer');   // existing
// NOTE: chat feed intentionally not used; we’re keeping Live ultra-clean

// --- Single Transcript helpers ---
let _txSeenLen = 0;
let _txLastLine = '';

function _ensureTrailingNewline(el){
  if (el && !el.value.endsWith('\n')) el.value += '\n';
}

function appendTranscriptLine(line) {
  if (!liveTranscript) return;
  const s = String(line ?? '').trim();
  if (!s || s === _txLastLine) return;     // de-dupe consecutive duplicates
  _txLastLine = s;
  liveTranscript.value += (liveTranscript.value ? '\n' : '') + s;
  _ensureTrailingNewline(liveTranscript);
  liveTranscript.scrollTop = liveTranscript.scrollHeight;
}

function appendTranscriptChunk(chunk){
  // Split on newlines and append each cleanly
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
    // Pulse + LED active
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
  // Stop pulse + LED
  document.body.classList.remove('companion-on');
  btnStart?.classList.remove('recording');
});

// Backend → UI
window.electron?.on('log', (t) => appendLog(t));
// Backend → UI (Transcript appends line-by-line)
// Live speech -> Transcript (append lines with 🎙 prefix)
window.electron?.on('live:transcript', (t) => {
  if (!transcriptSink) return;
  const parts = String(t || '').split(/\r?\n+/).map(x => x.trim()).filter(Boolean);
  parts.forEach(p => _appendDedup('🎙', p, 'bubble tx')); // 'tx' for system-style bubble if using a div
});

// AI answers -> Answer box (unchanged)
window.electron?.on('live:answer', (t) => {
  if (!t) return;
  if (isStatusyBanner(t)) {
    try { setState('listening'); } catch {}
    return;
  }
  if (liveAnswer) {
    liveAnswer.value = (liveAnswer.value ? liveAnswer.value + '\n---\n' : '') + t;
    liveAnswer.scrollTop = liveAnswer.scrollHeight;
  }
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
      setState('listening');                          // show while ON
      document.body.classList.add('companion-on');    // keep pulse styles active
      companionToggle?.classList.add('active','pulsing');
      companionToggle.textContent = 'Companion • ON';
    } else {
      setState('');                                   // <— CLEAR when OFF
      document.body.classList.remove('companion-on'); // stop pulse styles
      companionToggle?.classList.remove('active','pulsing');
      companionToggle.textContent = 'Companion';
      // if the textarea was showing a placeholder "Listening…", wipe it
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
    if (answerEl) {
      answerEl.value += (answerEl.value ? '\n' : '') + msg + '\n';
      answerEl.scrollTop = answerEl.scrollHeight;
    }
  });
}

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
on(clearBtn, 'click', () => { if (fileOutput) fileOutput.value = ''; });

// ------------------ Init ------------------
(async function init(){
  if (selDevice || inpGain || inpChunk) {
    await listDevices();
    await loadConfigToUI();
  }
  if (!liveTranscript) {
    appendLog('[ui] WARNING: #liveTranscript not found in DOM');
  }
})();
