// search/engines/googlePSE.js
// Google Programmable Search (Custom Search) wrapper

const fetch = require('node-fetch');

async function googlePseSearch(query, { maxResults = 5, timeoutMs = 2500 } = {}) {
  const key = process.env.GOOGLE_PSE_KEY;
  const cx  = process.env.GOOGLE_PSE_CX;

  if (!key || !cx) return [];

  const base = 'https://www.googleapis.com/customsearch/v1';
  const url =
    `${base}?key=${encodeURIComponent(key)}` +
    `&cx=${encodeURIComponent(cx)}` +
    `&q=${encodeURIComponent(query)}` +
    `&num=${maxResults}`;

  try {
    const res = await fetch(url, {
      timeout: timeoutMs,
      headers: { 'User-Agent': 'HaloAI/1.0' }
    });

    if (!res.ok) return [];

    const json = await res.json();
    const items = Array.isArray(json.items) ? json.items : [];

    return items.slice(0, maxResults).map(item => ({
      title: item.title || '',
      snippet: (item.snippet || item.htmlSnippet || item.title || '').replace(/\s+/g, ' ').trim(),
      url: item.link || ''
    }));
  } catch {
    return [];
  }
}

module.exports = { googlePseSearch };
