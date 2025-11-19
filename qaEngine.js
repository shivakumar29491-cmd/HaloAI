// =====================================================
// HaloAI — qaEngine.js (central QA / doc / web logic)
// =====================================================

const fetch = require('node-fetch');
const {
  searchWeb,
  duckDuckGoSearch,
  fetchAndExtract,
  setLogger: setWebLogger
} = require('./webSearchEngine');

const {
  extractiveSummary,
  chunkText,
  selectRelevantChunks,
  detectIntent
} = require('./textUtils');

/* =====================================================
   STATE
===================================================== */
let docContext = { name: '', text: '' };
let webPlus = false;
let useDoc = false;

let logFn = null;
let webSearchFn = null; // injected from main.js or falls back to searchWeb

/* =====================================================
   LOGGER
===================================================== */
function log(msg) {
  if (!logFn) return;
  try { logFn(msg); } catch {}
}

function init(opts = {}) {
  logFn = typeof opts.log === 'function' ? opts.log : null;
  setWebLogger(log);

  // If main.js injects a multi-provider engine (smartWebSearch), use it.
  // Otherwise fall back to our internal searchWeb().
  if (typeof opts.webSearch === 'function') {
    webSearchFn = opts.webSearch;
  } else {
    webSearchFn = async (query, maxResults = 4) => {
      try {
        return await searchWeb(query, maxResults);
      } catch (e) {
        log(`[searchWeb fallback error] ${e.message}`);
        return [];
      }
    };
  }
}

/* =====================================================
   STATE HELPERS
===================================================== */
function setDocContext(ctx) {
  docContext = {
    name: (ctx && ctx.name) || '',
    text: (ctx && ctx.text) || ''
  };
}

function clearDocContext() {
  docContext = { name: '', text: '' };
}

function getDocContext() {
  return { ...docContext };
}

function setUseDoc(flag) {
  useDoc = !!flag;
  return useDoc;
}

function setWebPlus(flag) {
  webPlus = !!flag;
  return webPlus;
}

/* =====================================================
   WEB HELPER — unified web snippet fetcher
   (wraps injected smartWebSearch OR legacy searchWeb)
===================================================== */
async function getWebSnippets(query, maxResults = 4) {
  let results = [];

  // 1) Prefer injected multi-provider engine from main.js
  if (webSearchFn) {
    try {
      const res = await webSearchFn(query);
      // smartWebSearch style: { provider, snippets }
      if (Array.isArray(res)) {
        results = res;
      } else if (res && Array.isArray(res.snippets)) {
        results = res.snippets;
      }
    } catch (e) {
      log(`[webSearchFn error] ${e.message}`);
    }
  }

  // 2) Fallback to legacy searchWeb if nothing came back
  if (!results || results.length === 0) {
    try {
      const legacy = await searchWeb(query, maxResults);
      if (Array.isArray(legacy) && legacy.length) {
        results = legacy;
      }
    } catch (e) {
      log(`[searchWeb legacy error] ${e.message}`);
    }
  }

  // Normalize shape
  return (results || [])
    .map(r => ({
      title:   r.title   || '',
      url:     r.url     || '',
      snippet: r.snippet || ''
    }))
    .filter(r => r.snippet)
    .slice(0, maxResults);
}

/* =====================================================
   LOCAL OLLAMA LLM
===================================================== */
async function askLocalLLM(promptText) {
  try {
    const body = {
      model: 'llama3',
      prompt: promptText,
      stream: false,
      options: { num_predict: 256, temperature: 0.5, top_k: 40, top_p: 0.9 }
    };

    const res = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const raw = await res.text();

    try {
      const j = JSON.parse(raw);
      if (typeof j?.response === 'string') return j.response.trim();
    } catch {}

    const merged = raw
      .split('\n')
      .map(line => {
        try { return JSON.parse(line).response || ''; }
        catch { return ''; }
      })
      .join('')
      .trim();

    return merged || raw.trim() || '(no reply)';
  } catch (e) {
    return `(local LLM error) ${e.message}`;
  }
}

async function askLocalLLMForCompanion(promptText) {
  return askLocalLLM(promptText);
}

/* =====================================================
   LOCAL DOC ANSWER
===================================================== */
async function askLocalDocAnswer(question, text) {
  const intent = detectIntent(question);
  const k = intent === 'qa' ? 6 : 10;

  const ctx = intent === 'qa'
    ? selectRelevantChunks(question, text, k).join('\n\n')
    : chunkText(text, 1400).slice(0, k).join('\n\n');

  const task =
    intent === 'summarize' ? 'Provide a concise summary.' :
    intent === 'highlights' ? 'List key points / action items as bullets.' :
    `Answer the question strictly from the document: ${question}`;

  const prompt = `You are HaloAI. Use ONLY the document below to respond.
If the document lacks the answer, say "I couldn't find this in the document."

Document:
"""
${ctx}
"""

Task: ${task}`;

  return await askLocalLLM(prompt);
}

async function localDocAnswer(question, text) {
  const intent = detectIntent(question);

  if (intent === 'summarize') {
    const s = extractiveSummary(text, '', 10);
    return s || 'I read the document but could not extract a clean summary.';
  }

  if (intent === 'highlights') {
    const s = extractiveSummary(text, '', 12);
    if (!s) return 'No clear highlights found.';
    const bullets = s
      .split(/(?<=[.!?])\s+/)
      .slice(0, 8)
      .map(x => `• ${x.trim()}`)
      .join('\n');
    return `Here are the key points:\n${bullets}`;
  }

  const ctx = selectRelevantChunks(question, text, 6).join('\n\n');
  const ans = extractiveSummary(ctx, question, 8);
  return ans || 'I checked the document but didn’t find a clear answer.';
}

/* =====================================================
   LOCAL HYBRID ANSWER (no OpenAI key or AI_MODE=web)
===================================================== */
async function localHybridAnswer(question, text) {
  const intent = detectIntent(question);

  const docCtx = intent === 'qa'
    ? selectRelevantChunks(question, text, 6).join('\n\n')
    : chunkText(text, 1400).slice(0, 8).join('\n\n');

  // First try fast multi-provider web snippets
  const results = await getWebSnippets(question, 4);
  const apiSnips = results
    .map(r => r.snippet || '')
    .filter(s => s && s.length > 40);

  let webCtx = apiSnips.join('\n');

  if (!webCtx) {
    // Fallback: HTML fetch via DuckDuckGo
    const links = await duckDuckGoSearch(question, 3);
    for (const u of links) {
      const t = await fetchAndExtract(u);
      if (t) webCtx += t + '\n\n';
    }
  }

  const docPart =
    intent === 'summarize' ? extractiveSummary(text, '', 10) :
    intent === 'highlights' ? extractiveSummary(text, '', 12) :
    extractiveSummary(docCtx, question, 7);

  const webPart = extractiveSummary(webCtx, question, 6);

  if (!docPart && !webPart) {
    return `I couldn't find enough in the document or the web for “${question}”. Try rephrasing.`;
  }

  let out = '';
  if (docPart) out += `From your document:\n${docPart}\n\n`;
  if (webPart) out += `From the web:\n${webPart}`;
  return out.trim();
}

/* =====================================================
   OPENAI DOC ANSWER  (disabled when AI_MODE=web)
===================================================== */
async function openAIDocAnswer(question, text) {
  const mode = String(process.env.AI_MODE || '').toLowerCase();
  const webOnly = mode === 'web';

  // In web-only mode we never call OpenAI
  if (webOnly) return localDocAnswer(question, text);

  const intent = detectIntent(question);
  const k = intent === 'qa' ? 6 : 12;

  const ctx = intent === 'qa'
    ? selectRelevantChunks(question, text, k).join('\n\n')
    : chunkText(text, 1400).slice(0, k).join('\n\n');

  const sys = `You are HaloAI. Answer ONLY using the provided document. If the document does not contain the answer, say "I couldn't find this in the document." Prefer concise bullets.`;

  const user = `Document: """\n${ctx}\n"""\n\nTask: ${
    intent === 'summarize'
      ? 'Provide a concise summary.'
      : intent === 'highlights'
        ? 'List the key points / action items as bullets.'
        : `Answer the question strictly from the document: ${question}`
  }`;

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers:{
        'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({
        model: process.env.FALLBACK_MODEL || 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 600,
        messages:[{role:'system',content:sys},{role:'user',content:user}]
      })
    });

    const txt = await r.text();
    let json;
    try { json = JSON.parse(txt); }
    catch { log(`[OpenAI raw] ${txt}`); }

    if (json?.error?.message) {
      log(`[OpenAI Error] ${json.error.message}`);
      return localDocAnswer(question, text);
    }

    return json?.choices?.[0]?.message?.content?.trim()
      || localDocAnswer(question, text);

  } catch(e) {
    log(`[OpenAI Exception] ${e.message}`);
    return localDocAnswer(question, text);
  }
}

/* =====================================================
   OPENAI HYBRID (doc + web)  (disabled when AI_MODE=web)
===================================================== */
async function openAIHybridAnswer(question, text) {
  const mode = String(process.env.AI_MODE || '').toLowerCase();
  const webOnly = mode === 'web';

  // In web-only mode we never call OpenAI
  if (webOnly) return localHybridAnswer(question, text);

  const intent = detectIntent(question);
  const k = intent === 'qa' ? 6 : 10;

  const docCtx = intent === 'qa'
    ? selectRelevantChunks(question, text, k).join('\n\n')
    : chunkText(text, 1400).slice(0, k).join('\n\n');

  // Fast multi-provider web snippets
  const results = await getWebSnippets(question, 4);
  const apiSnips = results
    .map(r => r.snippet || '')
    .filter(s => s && s.length > 40);

  let webCtx = apiSnips.join('\n');

  if (!webCtx) {
    // fallback HTML fetch
    const links = await duckDuckGoSearch(question, 4);
    for (const u of links) {
      const t = await fetchAndExtract(u);
      if (t) webCtx += t + '\n\n';
    }
  }

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

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers:{
        'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({
        model: process.env.FALLBACK_MODEL || 'gpt-4o-mini',
        temperature: 0.4,
        max_tokens: 700,
        messages:[{role:'system',content:sys},{role:'user',content:user}]
      })
    });

    const txt = await r.text();
    let json;
    try { json = JSON.parse(txt); }
    catch { log(`[OpenAI raw] ${txt}`); }

    if (json?.error?.message) {
      log(`[OpenAI Error] ${json.error.message}`);
      return await localHybridAnswer(question, text);
    }

    const out = json?.choices?.[0]?.message?.content?.trim();
    return out || await localHybridAnswer(question, text);

  } catch(e) {
    log(`[OpenAI Exception] ${e.message}`);
    return await localHybridAnswer(question, text);
  }
}

/* =====================================================
   GENERIC (NO DOC)
===================================================== */
async function genericAnswer(userText) {
  const mode     = String(process.env.AI_MODE || '').toLowerCase();
  const useLocal = mode === 'local';
  const webOnly  = mode === 'web';

  if (useLocal) {
    return await askLocalLLM(userText);
  }

  // ---- FAST WEB MODE: always use multi-provider web first ----
  const results = await getWebSnippets(userText, 4);
  const snippets = results
    .map(r => r.snippet || '')
    .filter(s => s && s.length > 40);

  if (snippets.length) {
    return `From the web:\n• ${snippets.join('\n• ')}`;
  }

  // In web-only mode we never go to OpenAI
  if (webOnly) {
    // Fallback: HTML fetch (old behavior)
    const links = await duckDuckGoSearch(userText, 4);
    const combined = [];
    for (const u of links){
      const t = await fetchAndExtract(u);
      const s = extractiveSummary(t || '', userText, 4);
      if (s) combined.push(s);
    }
    return combined.length
      ? `From the web:\n• ${combined.join('\n• ')}`
      : `I couldn’t find enough public info for “${userText}”.`;
  }

  // ---- Default cloud mode: try OpenAI after web ----
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()) {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method:'POST',
        headers:{
          'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type':'application/json'
        },
        body:JSON.stringify({
          model: process.env.FALLBACK_MODEL || 'gpt-4o-mini',
          temperature: 0.7,
          max_tokens: 350,
          messages:[
            {role:'system',content:'You are HaloAI. Provide clear, direct answers.'},
            {role:'user',content:userText}
          ]
        })
      });

      const txt = await r.text();
      let json;
      try { json = JSON.parse(txt); }
      catch { log(`[OpenAI raw] ${txt}`); }

      if (json?.error?.message) {
        log(`[OpenAI Error] ${json.error.message}`);
      }

      const out = json?.choices?.[0]?.message?.content?.trim();
      if (out) return out;

    } catch(e) {
      log(`[OpenAI Exception] ${e.message}`);
    }
  }

  // ---- Final fallback: HTML fetch (old behavior) ----
  const links = await duckDuckGoSearch(userText, 4);
  const combined = [];

  for (const u of links){
    const t = await fetchAndExtract(u);
    const s = extractiveSummary(t || '', userText, 4);
    if (s) combined.push(s);
  }

  return combined.length
    ? `From the web:\n• ${combined.join('\n• ')}`
    : `I couldn’t find enough public info for “${userText}”.`;
}

/* =====================================================
   ROUTER  (WITH OPTION-B & MODE AWARENESS)
===================================================== */
async function answer(userText) {
  const q = (userText || '').trim();
  if (!q) return '';

  const mode     = String(process.env.AI_MODE || '').toLowerCase();
  const useLocal = mode === 'local';
  const webOnly  = mode === 'web';

  const hasDoc = !!docContext.text;
  const mentionsDoc = /\b(document|doc|file|pdf|attached|code review)\b/i.test(q);
  const shouldUseDoc = (useDoc || mentionsDoc) && hasDoc;

  // ---- LOCAL LLM ----
  if (useLocal) {
    if (shouldUseDoc) return await askLocalDocAnswer(q, docContext.text);
    return await askLocalLLM(q);
  }

  // ---- DOC PATH (web or cloud) ----
  if (shouldUseDoc) {
    const wantsWeb =
      webPlus ||
      /^web:/i.test(q) ||
      /\b(latest|price|202[4-9])\b/i.test(q);

    if (wantsWeb) {
      // In web-only mode or no OpenAI key -> localHybrid
      if (webOnly || !process.env.OPENAI_API_KEY) {
        return await localHybridAnswer(q, docContext.text);
      }
      return await openAIHybridAnswer(q, docContext.text);
    }

    // Doc-only
    if (webOnly || !process.env.OPENAI_API_KEY) {
      return await localDocAnswer(q, docContext.text);
    }
    return await openAIDocAnswer(q, docContext.text);
  }

  // ---- GENERIC ----
  return await genericAnswer(q);
}

/* =====================================================
   EXPORTS
===================================================== */
module.exports = {
  init,
  answer,
  setDocContext,
  clearDocContext,
  getDocContext,
  setUseDoc,
  setWebPlus,
  askLocalLLMForCompanion
};
