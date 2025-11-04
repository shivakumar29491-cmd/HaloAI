// ---------- Tabs ----------
const tabs = document.querySelectorAll('.tab');
const panels = {
  live: document.getElementById('tab-live'),
  pre:  document.getElementById('tab-pre'),
  logs: document.getElementById('tab-logs'),
};
tabs.forEach(t => t.addEventListener('click', () => {
  tabs.forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  const key = t.dataset.tab;
  Object.values(panels).forEach(p => p.classList.remove('show'));
  panels[key === 'pre' ? 'pre' : key].classList.add('show');
}));

// ---------- Window controls ----------
document.getElementById('btn-min')?.addEventListener('click', () => window.windowCtl.minimize());
document.getElementById('btn-max')?.addEventListener('click', () => window.windowCtl.maximize());
document.getElementById('btn-close')?.addEventListener('click', () => window.windowCtl.close());

// ---------- Live UI ----------
const startBtn       = document.getElementById('startBtn');
const stopBtn        = document.getElementById('stopBtn');
const liveState      = document.getElementById('liveState');
const liveTranscript = document.getElementById('liveTranscript');
const liveAnswer     = document.getElementById('liveAnswer');
const liveLog        = document.getElementById('liveLog');

// new controls
const selDevice  = document.getElementById('soxDevice');
const btnRefresh = document.getElementById('refreshDevices');
const btnTest    = document.getElementById('testMic');
const inpGain    = document.getElementById('gainDb');
const inpChunk   = document.getElementById('chunkMs');

function appendLog(t) {
  if (!liveLog) return;
  liveLog.value += (t.endsWith('\n') ? t : t + '\n');
  liveLog.scrollTop = liveLog.scrollHeight;
}

async function loadConfigToUI() {
  try {
    const cfg = await window.electron.invoke('rec:getConfig');
    if (inpGain)  inpGain.value  = cfg.gainDb ?? '0';
    if (inpChunk) inpChunk.value = cfg.chunkMs ?? 6000;
  } catch (e) {
    appendLog(`[ui] loadConfig error: ${e.message}`);
  }
}

async function listDevices() {
  try {
    const r = await window.electron.invoke('sox:devices');
    if (!selDevice) return;

    selDevice.innerHTML = '';

    const defOpt = document.createElement('option');
    defOpt.value = 'default';
    defOpt.textContent = 'default (Windows default recording device)';
    selDevice.appendChild(defOpt);

    (r.items || []).forEach(i => {
      const o = document.createElement('option');
      o.value = String(i.id);
      o.textContent = `${i.id} — ${i.name}`;
      selDevice.appendChild(o);
    });

    selDevice.value = r.selected || 'default';

    if (!r.items || r.items.length === 0) {
      appendLog('[ui] No explicit devices listed. You can still try "default", or click Refresh after fixing SoX PATH (see Logs).');
    }
  } catch (e) {
    appendLog(`[ui] device list error: ${e.message}`);
  }
}

async function pushConfig() {
  const cfg = {
    device: selDevice?.value ?? 'default',
    gainDb: inpGain?.value ?? '0',
    chunkMs: Math.max(1000, Number(inpChunk?.value || 6000))
  };
  try {
    await window.electron.invoke('rec:setConfig', cfg);
  } catch (e) {
    appendLog(`[ui] rec:setConfig error: ${e.message}`);
  }
}

startBtn?.addEventListener('click', async () => {
  if (liveState) liveState.textContent = 'starting...';
  await pushConfig();
  const r = await window.electron.invoke('live:start');
  if (liveState) liveState.textContent = r?.ok ? 'listening' : 'error';
});

stopBtn?.addEventListener('click', async () => {
  await window.electron.invoke('live:stop');
  if (liveState) liveState.textContent = 'idle';
});

btnRefresh?.addEventListener('click', async () => {
  await listDevices();
  appendLog('[ui] refreshed input device list');
});

selDevice?.addEventListener('change', async () => {
  await pushConfig();
  appendLog(`[ui] set device=${selDevice.value}`);
});

inpGain?.addEventListener('change', async () => {
  await pushConfig();
  appendLog(`[ui] set gain=${inpGain.value}dB`);
});

inpChunk?.addEventListener('change', async () => {
  await pushConfig();
  appendLog(`[ui] set chunkMs=${inpChunk.value}`);
});

btnTest?.addEventListener('click', async () => {
  await pushConfig();
  appendLog('[test] recording 3s…');
  const r = await window.electron.invoke('rec:test');
  appendLog(`[test] file=${r.file} size=${r.size} bytes`);
  if (r.transcript) {
    if (liveTranscript) liveTranscript.value = r.transcript;
    appendLog(`[test] transcript: ${r.transcript}`);
  } else {
    appendLog('[test] (no transcript — check device selection, gain, and Windows mic privacy)');
  }
});

window.electron.on('log', (t) => appendLog(t));
window.electron.on('live:transcript', (t) => {
  if (!liveTranscript) return;
  liveTranscript.value = t;
  liveTranscript.scrollTop = liveTranscript.scrollHeight;
});
window.electron.on('live:answer', (t) => {
  if (!t || !liveAnswer) return;
  liveAnswer.value = (liveAnswer.value ? liveAnswer.value + '\n---\n' : '') + t;
  liveAnswer.scrollTop = liveAnswer.scrollHeight;
});

// ---------- Pre-recorded UI ----------
const pickAudioBtn  = document.getElementById('pickAudioBtn');
const transcribeBtn = document.getElementById('transcribeBtn');
const clearBtn      = document.getElementById('clearBtn');
const filePathEl    = document.getElementById('filePath');
const fileOutput    = document.getElementById('fileOutput');

let pickedPath = null;

pickAudioBtn?.addEventListener('click', async () => {
  const p = await window.electron.invoke('pick:audio');
  pickedPath = p;
  if (filePathEl) filePathEl.textContent = p ? p : 'No file selected.';
});

transcribeBtn?.addEventListener('click', async () => {
  if (!pickedPath) { if (fileOutput) fileOutput.value += 'Pick a file first.\n'; return; }
  const r = await window.electron.invoke('whisper:transcribe', pickedPath);
  if (fileOutput) fileOutput.value += (r?.output || '') + '\n';
});

clearBtn?.addEventListener('click', () => { if (fileOutput) fileOutput.value = ''; });

// init
listDevices().then(loadConfigToUI);
