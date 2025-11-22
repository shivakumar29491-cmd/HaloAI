// companion.js — Phase 8.3 Upgrade (stable, non-breaking)
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class LiveCompanion extends EventEmitter {
  constructor(opts) {
    super();
    this.opts = Object.assign({
      soxBin: process.env.SOX_BIN || 'sox',
      whisperBin: process.env.WHISPER_BIN || 'whisper-cli.exe',
      whisperModel: process.env.WHISPER_MODEL || 'base.en',

      device: process.env.REC_DEVICE || 'default',
      chunkSec: Number(process.env.CHUNK_SEC || 3.5),
      gainDb: Number(process.env.REC_GAIN_DB || 8),
      rateHz: 16000, bits: 16, channels: 1,

      maxSummaryChars: 4000,
      openaiKey: process.env.OPENAI_API_KEY || '',
      useWebFallback: true
    }, opts || {});

    this._running = false;
    this._rec = null;
    this._whisperRunning = false; // PHASE-8.3
    this._tmp = path.join(os.tmpdir(), 'halo_live_companion');

    if (!fs.existsSync(this._tmp))
      fs.mkdirSync(this._tmp, { recursive: true });
  }

  isRunning() { return this._running; }

  // ==========================================================
  // PHASE 8.3 — Safe async loop with sequencing (NO OVERLAPS)
  // ==========================================================
  start() {
    if (this._running) return;
    this._running = true;
    this.emit('state', { running: true });

    let idx = 0;

    const loop = async () => {
      if (!this._running) return;

      const wav = path.join(this._tmp, `chunk-${String(++idx).padStart(4,'0')}.wav`);

      // 1) RECORD (safe, sequential)
      await this._recordChunk(wav);

      // 2) Run whisper in background (non-blocking)
      await this._runWhisperChunk(wav);

      if (this._running) setTimeout(loop, 5);  // prevents overlaps
    };

    loop();
  }

  stop() {
    this._running = false;
    if (this._rec) { try { this._rec.kill('SIGKILL'); } catch {} }
    this.emit('state', { running: false });
  }

  // ==========================================================
  // AUDIO RECORDING (unchanged)
  // ==========================================================
  async _recordChunk(outWav) {
    const a = this.opts;
    const args = [
      '-q', '-t', 'waveaudio', a.device,
      '-r', String(a.rateHz), '-b', String(a.bits), '-c', String(a.channels),
      outWav,
      'trim', '0', String(a.chunkSec),
      'gain', String(a.gainDb)
    ];

    await new Promise((resolve) => {
      this._rec = spawn(a.soxBin, args, { windowsHide: true });
      this._rec.on('close', () => resolve());
      this._rec.on('error', () => resolve());
    });
  }

  // ==========================================================
  // PHASE 8.3 — Run Whisper safely (no double-spawn)
  // ==========================================================
  async _runWhisperChunk(wav) {
    if (this._whisperRunning) return;
    this._whisperRunning = true;

    try {
      const text = await this._whisper(wav);
      const formatted = this._cleanTranscript(text);

      if (formatted) {
        this.emit('transcript', { text: formatted, wav });

        const suggestion = await this._summarize(formatted).catch(() => '');
        if (suggestion) {
          this.emit('suggestion', { suggestion, source: 'ai' });
        }
      }
    } finally {
      this._whisperRunning = false;
    }
  }

  // ==========================================================
  // RAW Whisper call (unchanged)
  // ==========================================================
  async _whisper(wavPath) {
    return await new Promise((resolve) => {
      const outTxt = wavPath.replace(/\.wav$/i, '.txt');
      const base = wavPath.replace(/\.wav$/i, '');
      const args = [
        '-m', this.opts.whisperModel,
        '-f', wavPath,
        '-otxt', '-of', base,
        '-l', 'en'
      ];

      const p = spawn(this.opts.whisperBin, args, { windowsHide: true });

      p.on('close', () => {
        try {
          const text = fs.readFileSync(outTxt, 'utf8');
          resolve(text.trim());
        } catch { resolve(''); }
      });

      p.on('error', () => resolve(''));
    });
  }

  // ==========================================================
  // PHASE 8.3 — Clean Formatting
  // ==========================================================
  _cleanTranscript(t) {
    if (!t) return '';
    return t
      .replace(/\s+/g, ' ')       // collapse huge whitespace
      .replace(/\n{2,}/g, '\n')   // remove multiple empty lines
      .trim();
  }

  // ==========================================================
  // Suggestion logic (unchanged)
  // ==========================================================
  async _summarize(text) {
    const prompt = `You are a real-time assistant. Given this fresh transcript chunk, return a SHORT suggestion the user might want to do next (max 1–2 sentences). Transcript:\n"""${text.slice(-this.opts.maxSummaryChars)}"""`;

    if (this.opts.openaiKey) {
      const fetch = require('node-fetch');
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.opts.openaiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.2,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      try {
        const j = await r.json();
        return j?.choices?.[0]?.message?.content?.trim() || '';
      } catch { return ''; }
    }

    if (this.opts.useWebFallback) {
      return `Heard: “${text.slice(0, 120)}…”. You can ask: “Summarize and extract action items.”`;
    }
    return '';
  }
}

module.exports = { LiveCompanion };
