// answerRenderer.js

const $  = (sel) => document.querySelector(sel);
const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

const answerLog = $('#popoutAnswerLog');
const btnClose  = $('#btn-close-pop');

function appendAnswerBlock(text) {
  if (!answerLog) return;
  const s = String(text || '').trim();
  if (!s) return;

  const block = document.createElement('div');
  block.className = 'answer-block';
  block.textContent = s;

  const sep = document.createElement('div');
  sep.className = 'answer-separator';
  sep.textContent = '--- suggestion ended ---';

  answerLog.appendChild(block);
  answerLog.appendChild(sep);
  answerLog.scrollTop = answerLog.scrollHeight;
}

// Load existing history on startup
(async () => {
  try {
    const res = await window.electron?.invoke('answer:getHistory');
    if (res && res.ok && Array.isArray(res.items)) {
      res.items.forEach(appendAnswerBlock);
    }
  } catch (e) {
    // optional: console.error('[popout] getHistory error', e);
  }
})();

// Live updates from main process
window.electron?.on('answer:new', (t) => appendAnswerBlock(t));
window.electron?.on('answer:clear', () => {
  if (answerLog) answerLog.innerHTML = '';
});

// Simple close button
on(btnClose, 'click', () => window.close());
