// screenReader.js
// Dedicated module for Screen Reading (screenshot + Tesseract OCR)

const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const screenshot = require('screenshot-desktop');

let logFn = null;

function log(msg) {
  if (!logFn) return;
  try { logFn(msg); } catch {}
}

function getTmpDir() {
  const base = process.env.HALO_TMPDIR || os.tmpdir();
  const dir = path.join(base, 'haloai-screen');
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    log(`[screen] tmpdir error: ${e.message}`);
  }
  return dir;
}

// Capture the primary screen to a PNG file and return its path
async function captureScreenToPng() {
  const dir = getTmpDir();
  const file = path.join(dir, `screen_${Date.now()}.png`);
  log(`[screen] capturing to ${file}`);
  await screenshot({ filename: file });
  return file;
}

// Run Tesseract on the PNG and return extracted text
function runTesseract(pngPath) {
  const tessBin = process.env.TESSERACT_BIN || 'tesseract';
  const outBase = pngPath.replace(/\.png$/i, '');
  const txtPath = `${outBase}.txt`;
  const lang = process.env.TESS_LANG || 'eng';

  return new Promise((resolve, reject) => {
    const args = [pngPath, outBase, '-l', lang];
    log(`[screen] running: ${tessBin} ${args.join(' ')}`);

    let child;
    try {
      child = spawn(tessBin, args, { stdio: 'ignore' });
    } catch (e) {
      return reject(e);
    }

    child.on('error', (err) => reject(err));
    child.on('exit', (code) => {
      if (code !== 0) {
        return reject(new Error(`tesseract exited with code ${code}`));
      }
      try {
        const text = fs.existsSync(txtPath) ? fs.readFileSync(txtPath, 'utf8') : '';
        resolve((text || '').trim());
      } catch (e) {
        reject(e);
      }
    });
  });
}

// Initialize IPC handler
function initScreenReader({ ipcMain, log }) {
  logFn = typeof log === 'function' ? log : null;
  if (!ipcMain) return;

  ipcMain.handle('screen:readOnce', async () => {
    try {
      const pngPath = await captureScreenToPng();
      const text = await runTesseract(pngPath);
      log(`[screen] OCR complete (${text.length} chars)`);
      return { ok: true, text };
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      log(`[screen] ERROR: ${msg}`);
      return { ok: false, error: msg };
    }
  });
}

module.exports = {
  initScreenReader
};

