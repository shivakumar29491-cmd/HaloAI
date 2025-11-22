class ChatBox {
  constructor({ inputEl, sendBtn, answerArea, fileBtn, fileInput, badge }) {
    this.input     = inputEl;
    this.sendBtn   = sendBtn;
    this.answer    = answerArea;
    this.fileBtn   = fileBtn;
    this.fileInput = fileInput;
    this.badge     = badge;

    // Unified transcript sink: prefer #liveTranscript (textarea), else #chatFeed (div)
// Force textarea as the single transcript sink
this.transcript = document.getElementById('liveTranscript');
if (this.transcript && 'readOnly' in this.transcript) this.transcript.readOnly = true;
this.transcript?.setAttribute('contenteditable', 'false');
this.transcript?.setAttribute('aria-readonly', 'true');
this.transcript?.setAttribute('spellcheck', 'false');

    // Defensive: make transcript read-only
    if (this.transcript && 'readOnly' in this.transcript) this.transcript.readOnly = true;
    if (this.transcript) this.transcript.setAttribute('contenteditable', 'false');

    this.bind();
  }

  bind() {
    if (this.sendBtn) {
      this.sendBtn.addEventListener('click', () => this.submit());
    }
    if (this.input) {
      this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.submit(); });
    }
    if (this.fileBtn && this.fileInput) {
      this.fileBtn.addEventListener('click', () => this.fileInput.click());
      this.fileInput.addEventListener('change', () => this.ingest());
    }
    if (this.badge) {
      this.badge.addEventListener('click', async () => {
        await window.electron.invoke('doc:clear');
        this.badge.classList.add('hidden');
        this.badge.textContent = '';
      });
    }
  }

  // Keep Answer box clean of banners / status lines
  _isStatusyBanner(t) {
    const x = String(t || '');
    return (
      /^\s*🔊\s*Live Companion is ON/i.test(x) ||
      /^\s*No material changes\./i.test(x) ||
      /^\s*(Summary:|Action Items|From the web:)/i.test(x) ||
      /\b(PDF support not installed|PDF load error|Web\+\s+(enabled|disabled))\b/i.test(x) ||
      /^\s*Tip:\s+/i.test(x) ||
      /^\s*Status:\s+/i.test(x)
    );
  }

  _appendToTranscript(line) {
    if (!this.transcript) return;
    const s = String(line ?? '').trim();
    if (!s) return;

    // textarea sink
    if ('value' in this.transcript) {
  const ta = this.transcript;
  const needsSep = ta.value && !ta.value.endsWith('\n');
  ta.value += (needsSep ? '\n' : '') + s + '\n\n';   // ← two newlines for clear breaks
  ta.scrollTop = ta.scrollHeight;
  return;
}


    // div sink (chatFeed)
    const div = document.createElement('div');
    div.className = 'bubble me';
    div.textContent = s;
    this.transcript.appendChild(div);
    this.transcript.scrollTop = this.transcript.scrollHeight;
  }

  async submit() {
    const q = this.input?.value?.trim();
    if (!q) return;

    // 1) Mirror typed text into the single Transcript sink
    this._appendToTranscript(`You: ${q}`);

    // 2) Clear input
    this.input.value = '';

    // 3) Ask backend (no AI bubble to transcript)
    const ans = await window.electron.invoke('chat:ask', q);

       // 4) Answers go ONLY to the Answer area (textarea or div)
    if (this.answer && typeof ans === 'string') {
      const s = ans.trim();
      if (s && !this._isStatusyBanner(s)) {
        if (this.answer.tagName === 'DIV') {
          // New UI: div-based answer log
          const entry = document.createElement('div');
          entry.className = 'answer-block answer-entry';
          entry.textContent = s;
          this.answer.appendChild(entry);
          this.answer.scrollTop = this.answer.scrollHeight;
        } else {
          // Legacy textarea-based UI
          const sep = this.answer.value ? '\n---\n' : '';
          this.answer.value = (this.answer.value || '') + sep + s;
          this.answer.scrollTop = this.answer.scrollHeight;
        }
      }
    }

  }

  async ingest() {
    const f = this.fileInput?.files?.[0];
    if (!f) return;
    try {
      if (f.name.toLowerCase().endsWith('.txt')) {
        const text = await f.text();
        const res = await window.electron.invoke('doc:ingestText', { name: f.name, text });
        if (res?.ok) this.showBadge(f.name, res.chars);
      } else if (f.name.toLowerCase().endsWith('.pdf')) {
        const ab = await f.arrayBuffer();
        const bytes = Array.from(new Uint8Array(ab));
        const res = await window.electron.invoke('doc:ingestBinary', { name: f.name, bytes, mime: f.type || 'application/pdf' });
        if (res?.ok) this.showBadge(f.name, res.chars);
      }
    } finally {
      if (this.fileInput) this.fileInput.value = '';
    }
  }

  showBadge(name, count) {
    if (!this.badge) return;
    const pretty = name.length > 28 ? '…' + name.slice(-28) : name;
    this.badge.textContent = `${pretty} • ${count} chars  ×`;
    this.badge.title = 'Click to remove';
    this.badge.classList.remove('hidden');
  }
}

(() => {
  const inputEl = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSend');
  const ans     = document.getElementById('liveAnswer');
  const fileBtn = document.getElementById('fileBtn');
  const fileInp = document.getElementById('docInput');
  const badge   = document.getElementById('docBadge');

  if (inputEl && sendBtn) new ChatBox({
    inputEl, sendBtn, answerArea: ans, fileBtn, fileInput: fileInp, badge
  });
})();
