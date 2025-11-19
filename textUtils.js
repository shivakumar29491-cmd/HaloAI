// =====================================================
// HaloAI — textUtils.js (tokenizing, chunking, summaries, intent)
// =====================================================

// Stopword list (unchanged from main.js)
const STOP = new Set(
  'a an and are as at be by for from has have in into is it its of on or s t that the their to was were will with your you about this those these which who whom whose when where how why what can could should would may might not no yes more most very just also than then'
    .split(' ')
);

// Tokenizer (unchanged)
function tokenize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w && w.length > 1 && !STOP.has(w));
}

// Chunk text into roughly target-sized pieces (unchanged)
function chunkText(text, target = 1200) {
  const chunks = [];
  let buf = '';
  const paras = text.split(/\n{2,}/);

  for (const p of paras) {
    if ((buf + '\n\n' + p).length <= target) {
      buf = buf ? buf + '\n\n' + p : p;
    } else {
      if (buf) chunks.push(buf);
      if (p.length <= target) {
        chunks.push(p);
      } else {
        for (let i = 0; i < p.length; i += target) {
          chunks.push(p.slice(i, i + target));
        }
      }
      buf = '';
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

// Select chunks most relevant to the question (unchanged)
function selectRelevantChunks(question, text, k = 5) {
  const qTokens = tokenize(question);
  if (qTokens.length === 0) return [];

  const chunks = chunkText(text, 1400);
  const scored = chunks
    .map((c, idx) => {
      const tks = tokenize(c);
      const set = new Set(tks);
      let score = 0;
      qTokens.forEach(q => {
        if (set.has(q)) score += 1;
      });
      // small length bonus to avoid picking tiny fragments
      score += Math.min(5, Math.floor(tks.length / 120));
      return { idx, c, score };
    })
    .sort((a, b) => b.score - a);

  return scored.slice(0, k).map(x => x.c);
}

// Simple intent detector (unchanged)
function detectIntent(q) {
  const s = q.toLowerCase();
  if (/(summari[sz]e|tl;dr|overview)/.test(s)) return 'summarize';
  if (/(key points|highlights|bullets?|action items|takeaways)/.test(s)) return 'highlights';
  return 'qa';
}

// Extractive summary (unchanged)
function extractiveSummary(text, query, maxSentences = 6) {
  if (!text) return '';
  const qwords = (query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const sents = text.split(/(?<=[.!?])\s+/);
  const scored = sents
    .map(s => {
      const lw = s.toLowerCase();
      let score = 0;
      qwords.forEach(q => {
        if (lw.includes(q)) score++;
      });
      return { s: s.trim(), score };
    })
    .sort((a, b) => b.score - a.score);

  const chosen = scored
    .filter(x => x.s.length > 30)
    .slice(0, maxSentences)
    .map(x => x.s);

  return chosen.length
    ? chosen.join(' ')
    : sents.slice(0, maxSentences).join(' ').trim();
}

module.exports = {
  tokenize,
  chunkText,
  selectRelevantChunks,
  detectIntent,
  extractiveSummary
};
