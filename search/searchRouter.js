// search/searchRouter.js
// Central web-search router for HaloAI (Phase 5.6–5.10)

const fetch   = require('node-fetch');
const cheerio = require('cheerio');

const { bingSearch }     = require('./engines/bing');
const { serpapiSearch }  = require('./engines/serpapi');
const { googlePseSearch } = require('./engines/googlePSE');

const stats = {
  bing:       { used: 0 },
  serpapi:    { used: 0 },
  googlePSE:  { used: 0 },
  duckduckgo: { used: 0 }
};

function safeLog(log, msg) {
  if (typeof log === 'function') {
    try { log(msg); } catch {}
  }
}

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
      name: 'duckduckgo',
      enabled: true,
      searchFn: duckduckgoSearch
    }
  ];
}

// Basic DuckDuckGo HTML search fallback
async function duckduckgoSearch(query, { maxResults = 5, timeoutMs = 3000 } = {}) {
  const q = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${q}`;
  try {
    const res = await fetch(url, {
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HaloAI'
      }
    });
    const html = await res.text();
    const $ = cheerio.load(html);
    const results = [];
    $('a.result__a').each((i, el) => {
      if (results.length >= maxResults) return false;
      const title = $(el).text().trim();
      const href  = $(el).attr('href') || '';
      if (!href) return;
      let url = href;
      try {
        const u = new URL(href, 'https://duckduckgo.com');
        url = u.href;
      } catch {}
      results.push({
        title: title || url,
        snippet: title || url,
        url
      });
    });
    return results;
  } catch {
    return [];
  }
}

// FASTEST strategy: fire all primary providers in parallel, pick first non-empty
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
          safeLog(log, `[search] mode=${mode} query="${query}" provider=${p.name} latency=${latency}ms used=${stats[p.name].used}`);
          resolve(list.map(r => ({
            title:   r.title   || '',
            snippet: r.snippet || '',
            url:     r.url     || '',
            provider: p.name,
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

// SEQUENTIAL strategy: try providers in given order, stop on first non-empty
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
      safeLog(log, `[search] mode=${mode} query="${query}" provider=${name} latency=${latency}ms used=${stats[name].used}`);
      return list.map(r => ({
        title:   r.title   || '',
        snippet: r.snippet || '',
        url:     r.url     || '',
        provider: name,
        latencyMs: latency
      }));
    }
  }
  return [];
}

// Main entry
async function smartSearch(query, options = {}) {
  const modeRaw = process.env.SEARCH_MODE || 'fastest';
  const mode = String(modeRaw).toLowerCase();
  const maxResults = options.maxResults || 5;
  const timeoutMs  = options.timeoutMs || 2500;
  const log        = options.log;

  const providers = providerConfig();
  const primary = providers.filter(p => p.name !== 'duckduckgo' && p.enabled);
  const ddg     = providers.find(p => p.name === 'duckduckgo');

  if (!query || !query.trim()) return [];

  if (mode === 'local-only') {
    safeLog(log, `[search] mode=local-only — skipping web for query="${query}"`);
    return [];
  }

  // No primary engines configured → go straight to DuckDuckGo
  if (!primary.length && ddg) {
    const t0 = Date.now();
    const list = await ddg.searchFn(query, { maxResults, timeoutMs });
    const latency = Date.now() - t0;
    if (Array.isArray(list) && list.length) {
      stats.duckduckgo.used++;
      safeLog(log, `[search] mode=${mode} query="${query}" provider=duckduckgo latency=${latency}ms used=${stats.duckduckgo.used}`);
      return list.map(r => ({
        title:   r.title   || '',
        snippet: r.snippet || '',
        url:     r.url     || '',
        provider: 'duckduckgo',
        latencyMs: latency
      }));
    }
    return [];
  }

  let results = [];

  if (mode === 'cheapest') {
    const order = ['googlePSE', 'bing', 'serpapi'];
    results = await sequentialStrategy(query, order, providers, { maxResults, timeoutMs, mode, log });
  } else if (mode === 'accurate') {
    const order = ['bing', 'serpapi', 'googlePSE'];
    results = await sequentialStrategy(query, order, providers, { maxResults, timeoutMs, mode, log });
  } else { // fastest (default)
    results = await fastestStrategy(query, primary, { maxResults, timeoutMs, mode, log });
  }

  // Fallback to DuckDuckGo if nothing came back
  if ((!results || !results.length) && ddg) {
    safeLog(log, `[search] all primary providers failed, falling back to duckduckgo`);
    const t0 = Date.now();
    const list = await ddg.searchFn(query, { maxResults, timeoutMs });
    const latency = Date.now() - t0;
    if (Array.isArray(list) && list.length) {
      stats.duckduckgo.used++;
      safeLog(log, `[search] mode=${mode} query="${query}" provider=duckduckgo latency=${latency}ms used=${stats.duckduckgo.used}`);
      return list.map(r => ({
        title:   r.title   || '',
        snippet: r.snippet || '',
        url:     r.url     || '',
        provider: 'duckduckgo',
        latencyMs: latency
      }));
    }
  }

 const { rescoreSnippets } = require('./searchRouter'); // at top if needed

// --- END OF PRIMARY SEARCH LOGIC ---

if (!results || !results.length) return [];

// Apply rescoring on final snippet set
const rescored = rescoreSnippets(results, query, 4);
return rescored;
}

function getProviderStats() {
  return JSON.parse(JSON.stringify(stats));
}

// =====================================================
// SNIPPET RESCORING ENGINE (Phase 6.4)
// =====================================================

// Provider weights (tunable)
const PROVIDER_WEIGHT = {
  bing: 1.2,
  serpapi: 1.1,
  googlePSE: 1.0,
  duckduckgo: 0.8
};

// Score one snippet
function scoreSnippet(snippet, query, provider) {
  const text = (snippet || '').toLowerCase();
  const q = (query || '').toLowerCase();

  // Keyword match
  let keywordScore = 0;
  const words = q.split(/\s+/);
  for (const w of words) {
    if (w.length > 3 && text.includes(w)) keywordScore++;
  }

  // Snippet length score
  const lengthScore = Math.min((snippet || '').length / 80, 2);

  // Provider trust
  const providerScore = PROVIDER_WEIGHT[provider] || 1.0;

  return (keywordScore + lengthScore) * providerScore;
}

// Top-N rescoring
function rescoreSnippets(snippets, query, topN = 4) {
  return snippets
    .map(s => ({
      ...s,
      _score: scoreSnippet(s.snippet, query, s.provider)
    }))
    .sort((a, b) => b._score - a._score)
    .slice(0, topN);
}

// Final exports
module.exports = {
  smartSearch,
  getProviderStats,
  rescoreSnippets
};
