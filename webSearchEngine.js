// =====================================================
// HaloAI — webSearchEngine.js (multi-engine search API layer)
// =====================================================

const fetch   = require('node-fetch');
const cheerio = require('cheerio');
const { URL } = require('url');

let logFn = null;

function log(msg) {
  if (!logFn) return;
  try { logFn(msg); } catch {}
}

function setLogger(fn) {
  logFn = typeof fn === 'function' ? fn : null;
}

// ---------- Base class ----------
class BaseSearchEngine {
  constructor(name) { this.name = name; }
  isEnabled() { return false; }
  async search(_query, _maxResults) { return []; }
}

// ---------- SerpAPI (Google-like, needs SERPAPI_KEY) ----------
class SerpApiEngine extends BaseSearchEngine {
  constructor() {
    super('serpapi');
    this.key = process.env.SERPAPI_KEY || '';
  }
  isEnabled() { return !!this.key; }

  async search(query, maxResults = 5) {
    const params = new URLSearchParams({
      q: query,
      engine: 'google',
      api_key: this.key,
      num: String(maxResults)
    });
    const url = `https://serpapi.com/search?${params.toString()}`;
    log(`[SerpAPI] GET ${url}`);
    const res = await fetch(url);
    const json = await res.json();
    const items = json.organic_results || [];
    return items.slice(0, maxResults).map(r => ({
      title: r.title || '',
      url:   r.link || r.url || '',
      snippet:
        r.snippet ||
        (Array.isArray(r.snippet_highlighted_words)
          ? r.snippet_highlighted_words.join(' ')
          : '')
    })).filter(x => x.url);
  }
}

// ---------- Bing Web Search (needs BING_SEARCH_KEY) ----------
class BingEngine extends BaseSearchEngine {
  constructor() {
    super('bing');
    this.key = process.env.BING_SEARCH_KEY || '';
  }
  isEnabled() { return !!this.key; }

  async search(query, maxResults = 5) {
    const params = new URLSearchParams({ q: query, count: String(maxResults) });
    const url = `https://api.bing.microsoft.com/v7.0/search?${params.toString()}`;
    log(`[Bing] GET ${url}`);
    const res = await fetch(url, {
      headers: { 'Ocp-Apim-Subscription-Key': this.key }
    });
    const json = await res.json();
    const items = (json.webPages && json.webPages.value) || [];
    return items.slice(0, maxResults).map(r => ({
      title: r.name || '',
      url:   r.url  || '',
      snippet: r.snippet || r.description || ''
    })).filter(x => x.url);
  }
}

// ---------- DuckDuckGo HTML (fallback, no key) ----------
class DuckDuckGoHtmlEngine extends BaseSearchEngine {
  constructor() { super('ddg-html'); }
  isEnabled() { return true; }

  async search(query, maxResults = 5) {
    const q = encodeURIComponent(query);
    const url = `https://html.duckduckgo.com/html/?q=${q}`;
    log(`[DDG] GET ${url}`);
    const res = await fetch(url, {
  headers: { 'User-Agent': 'Mozilla/5.0' },
  timeout: 4000   // 4-second hard timeout so we never hang forever
});

    const html = await res.text();
    const $ = cheerio.load(html);

    const out = [];
    $('div.result').each((_, el) => {
      if (out.length >= maxResults) return;
      const a = $(el).find('a.result__a').first();
      const href = a.attr('href');
      if (!href) return;
      let finalUrl = href;
      try { finalUrl = new URL(href, 'https://duckduckgo.com').href; } catch {}
      const snippet = $(el).find('.result__snippet, .result__body').text().replace(/\s+/g, ' ').trim();
      out.push({
        title: a.text().trim(),
        url:   finalUrl,
        snippet
      });
    });

    // Fallback: any http links
    if (out.length === 0) {
      $('a').each((_, el) => {
        if (out.length >= maxResults) return;
        const href = $(el).attr('href');
        if (href && href.startsWith('http')) {
          out.push({ title: '', url: href, snippet: '' });
        }
      });
    }

    return out.slice(0, maxResults);
  }
}

// ---------- Engine selection ----------
const engines = [
  new SerpApiEngine(),
  new BingEngine(),
  new DuckDuckGoHtmlEngine() // always last fallback
];

function pickEngine() {
  const e = engines.find(e => e.isEnabled());
  log(`[searchWeb] using engine=${e ? e.name : 'none'}`);
  return e || engines[engines.length - 1];
}

// ---------- Public API ----------

// Main new API: returns [{title,url,snippet}]
async function searchWeb(query, maxResults = 5) {
  try {
    const engine = pickEngine();
    const results = await engine.search(query, maxResults);
    return Array.isArray(results) ? results : [];
  } catch (e) {
    log(`[searchWeb error] ${e.message}`);
    return [];
  }
}

// Legacy helper: kept for compatibility with old code
async function duckDuckGoSearch(query, maxResults = 5) {
  const results = await searchWeb(query, maxResults);
  return results.map(r => r.url);
}

// Still used in some doc/web flows to grab full page text
async function fetchAndExtract(url) {
  try{
    log(`[fetchAndExtract] GET ${url}`);
    const res = await fetch(url, {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    const paras = [];
    $('p, article p, div p, section p').each((i, el) => {
      let t = $(el).text().replace(/\s+/g,' ').trim();
      if (t.length > 50 && !/cookie|subscribe|advert/i.test(t)) paras.push(t);
    });
    if (paras.length === 0) {
      $('div').each((i, el) => {
        const t = $(el).text().replace(/\s+/g,' ').trim();
        if (t.length > 80 && t.split(' ').length > 10) paras.push(t);
      });
    }
    const uniq = Array.from(new Set(paras)).filter(p => p.length > 40).slice(0, 10);
    if (uniq.length === 0) return null;
    return uniq.join('\n\n');
  }catch(e){
    log(`[fetchAndExtract error] ${e.message}`);
    return null;
  }
}

module.exports = {
  setLogger,
  searchWeb,
  duckDuckGoSearch,   // legacy usage
  fetchAndExtract      // legacy usage
};
