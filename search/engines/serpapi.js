// search/engines/serpapi.js
// SerpAPI wrapper returning normalized results

const fetch = require('node-fetch');

async function serpapiSearch(query, { maxResults = 5, timeoutMs = 2500 } = {}) {
  const key = process.env.SERPAPI_KEY;
  if (!key) return [];

  const base = 'https://serpapi.com/search.json';
  const url = `${base}?engine=google&q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url, {
      timeout: timeoutMs,
      headers: { 'User-Agent': 'HaloAI/1.0' }
    });

    if (!res.ok) return [];

    const json = await res.json();
    const items = Array.isArray(json.organic_results) ? json.organic_results : [];

    return items.slice(0, maxResults).map(item => ({
      title: item.title || '',
      snippet: item.snippet || item.title || '',
      url: item.link || ''
    }));
  } catch {
    return [];
  }
}

module.exports = { serpapiSearch };
