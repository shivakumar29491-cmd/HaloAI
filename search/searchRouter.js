// search/searchRouter.js
// Central web-search router for HaloAI (Phase 5.6–5.10 + Phase 8 Upgrades)

const fetch   = require('node-fetch');
const cheerio = require('cheerio');

// Existing providers
const { bingSearch }       = require('./engines/bing');
const { serpapiSearch }    = require('./engines/serpapi');
const { googlePseSearch }  = require('./engines/googlePSE');

// NEW Phase 8 providers
const { braveSearch }      = require('./engines/braveApi');   // must exist
const { groqSearch }       = require('./engines/groqApi');    // new file you added

// ==============================================
// Phase 8.4 — Missing Key Warnings (one-time)
// ==============================================
let warned = {
  bing: false,
  serpapi: false,
  googlePSE: false,
  brave: false,
  groq: false
};

function warnMissingKeys(log) {
  if (!log) return;

  if (!process.env.BING_API_KEY && !warned.bing) {
    log("⚠️ Bing API key missing — skipping Bing provider.");
    warned.bing = true;
  }
  if (!process.env.SERPAPI_KEY && !warned.serpapi) {
    log("⚠️ SerpAPI key missing — skipping SerpAPI provider.");
    warned.serpapi = true;
  }
  if ((!process.env.GOOGLE_PSE_KEY || !process.env.GOOGLE_PSE_CX) && !warned.googlePSE) {
    log("⚠️ Google PSE keys missing — skipping Google PSE.");
    warned.googlePSE = true;
  }
  if (!process.env.BRAVE_API_KEY && !warned.brave) {
    log("⚠️ Brave API key missing — skipping Brave.");
    warned.brave = true;
  }
  if (!process.env.GROQ_API_KEY && !warned.groq) {
    log("⚠️ Groq API key missing — skipping Groq Web provider.");
    warned.groq = true;
  }
}


// --------------------
// Provider Stats
// --------------------
const stats = {
  bing:       { used: 0 },
  serpapi:    { used: 0 },
  googlePSE:  { used: 0 },
  brave:      { used: 0 },
  groq:       { used: 0 }
};

// --------------------
// Safe Logger
// --------------------
function safeLog(log, msg) {
  if (typeof log === 'function') {
    try { log(msg); } catch {}
  }
}

// --------------------
// Provider Config (PHASE 8 VERSION)
// --------------------
function providerConfig() {
  return [
    {
      name: 'bing',
      enabled: !!process.env.BING_API_KEY,
      searchFn: bingSearch
    },
    {
      name: 'serpapi',
      enabled: !!process.env.SERPAPI_KEY,
      searchFn: serpapiSearch
    },
    {
      name: 'googlePSE',
      enabled: !!process.env.GOOGLE_PSE_KEY && !!process.env.GOOGLE_PSE_CX,
      searchFn: googlePseSearch
    },
    {
      name: 'brave',
      enabled: !!process.env.BRAVE_API_KEY,
      searchFn: braveSearch
    },
    {
      name: 'groq',
      enabled: !!process.env.GROQ_API_KEY,
      searchFn: groqSearch
    }
  ];
}

// -----------------------------------------------------------
// PHASE 8 — queryProvider (needed for Race Engine)
// -----------------------------------------------------------
async function queryProvider(providerName, query, options = {}) {
  const providers = providerConfig();
  const found = providers.find(p => p.name === providerName && p.enabled);

  if (!found) return { answer: "", provider: providerName };

  const maxResults = options.maxResults || 5;
  const timeoutMs  = options.timeoutMs  || 2500;

  try {
    const list = await found.searchFn(query, { maxResults, timeoutMs });
    if (!Array.isArray(list) || !list.length)
      return { answer: "", provider: providerName };

    return {
      answer: list[0].snippet || "",
      provider: providerName,
      raw: list
    };
  } catch (err) {
    return { answer: "", provider: providerName };
  }
}

// -----------------------------------------------------------
// FASTEST strategy (unchanged, except now uses new providers)
// -----------------------------------------------------------
async function fastestStrategy(query, providers, { maxResults, timeoutMs, mode, log }) {
  if (!providers.length) return [];

  return new Promise((resolve) => {
    let resolved = false;
    let finished = 0;

    providers.forEach(p => {
      (async () => {
        const t0 = Date.now();
        let list = [];
        try {
          list = await p.searchFn(query, { maxResults, timeoutMs });
        } catch {
          list = [];
        }
        const latency = Date.now() - t0;
        finished++;

        if (!resolved && Array.isArray(list) && list.length) {
          resolved = true;
          stats[p.name].used++;
          safeLog(log, `[search] mode=${mode} provider=${p.name} latency=${latency}ms`);
          resolve(list.map(r => ({
            title:     r.title   || '',
            snippet:   r.snippet || '',
            url:       r.url     || '',
            provider:  p.name,
            latencyMs: latency
          })));
        } else if (finished === providers.length && !resolved) {
          resolved = true;
          resolve([]);
        }
      })();
    });
  });
}

// -----------------------------------------------------------
// SEQUENTIAL strategy (unchanged)
// -----------------------------------------------------------
async function sequentialStrategy(query, orderedNames, providers, { maxResults, timeoutMs, mode, log }) {
  const map = Object.fromEntries(providers.map(p => [p.name, p]));
  for (const name of orderedNames) {
    const p = map[name];
    if (!p || !p.enabled) continue;

    const t0 = Date.now();
    let list = [];
    try {
      list = await p.searchFn(query, { maxResults, timeoutMs });
    } catch {
      list = [];
    }

    const latency = Date.now() - t0;

    if (Array.isArray(list) && list.length) {
      stats[name].used++;
      safeLog(log, `[search] mode=${mode} provider=${name} latency=${latency}ms`);

      return list.map(r => ({
        title:     r.title   || '',
        snippet:   r.snippet || '',
        url:       r.url     || '',
        provider:  name,
        latencyMs: latency
      }));
    }
  }
  return [];
}

// -----------------------------------------------------------
// Main Search Function (smartSearch)
// -----------------------------------------------------------
async function smartSearch(query, options = {}) {
  warnMissingKeys(options.log);
  const modeRaw    = process.env.SEARCH_MODE || 'fastest';
  const mode       = String(modeRaw).toLowerCase();
  const maxResults = options.maxResults || 5;
  const timeoutMs  = options.timeoutMs  || 2500;
  const log        = options.log;

  if (!query || !query.trim()) return [];

  const providers = providerConfig();
  const enabled = providers.filter(p => p.enabled);

  if (!enabled.length) return [];

  let results = [];

  if (mode === 'cheapest') {
    const order = ['googlePSE', 'bing', 'serpapi', 'brave', 'groq'];
    results = await sequentialStrategy(query, order, providers, { maxResults, timeoutMs, mode, log });
  } 
  else if (mode === 'accurate') {
    const order = ['bing', 'serpapi', 'googlePSE', 'brave', 'groq'];
    results = await sequentialStrategy(query, order, providers, { maxResults, timeoutMs, mode, log });
  } 
  else {
    // fastest (default)
    results = await fastestStrategy(query, enabled, { maxResults, timeoutMs, mode, log });
  }

  if (!results || !results.length) return [];

  const rescored = rescoreSnippets(results, query, 4);
  return rescored;
}

// -----------------------------------------------------------
// Provider Stats (unchanged)
// -----------------------------------------------------------
function getProviderStats() {
  return JSON.parse(JSON.stringify(stats));
}

// -----------------------------------------------------------
// SNIPPET RESCORING (unchanged)
// -----------------------------------------------------------
const PROVIDER_WEIGHT = {
  bing: 1.2,
  serpapi: 1.1,
  googlePSE: 1.0,
  brave: 1.0,
  groq: 0.9
};

function scoreSnippet(snippet, query, provider) {
  const text = (snippet || '').toLowerCase();
  const q = (query || '').toLowerCase();

  let keywordScore = 0;
  const words = q.split(/\s+/);
  for (const w of words) {
    if (w.length > 3 && text.includes(w)) keywordScore++;
  }

  const lengthScore = Math.min((snippet || '').length / 80, 2);

  const providerScore = PROVIDER_WEIGHT[provider] || 1.0;

  return (keywordScore + lengthScore) * providerScore;
}

function rescoreSnippets(snippets, query, topN = 4) {
  return snippets
    .map(s => ({
      ...s,
      _score: scoreSnippet(s.snippet, query, s.provider)
    }))
    .sort((a, b) => b._score - a._score)
    .slice(0, topN);
}

// -----------------------------------------------------------
// EXPORTS
// -----------------------------------------------------------
module.exports = {
  smartSearch,
  getProviderStats,
  rescoreSnippets,
  queryProvider  // <-- NEW PHASE 8
};
