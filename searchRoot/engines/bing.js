// search/engines/bing.js
// Simple Bing Web Search wrapper returning normalized results

const fetch = require('node-fetch');

async function bingSearch(query, { maxResults = 5, timeoutMs = 2500 } = {}) {
  const key = process.env.BING_API_KEY;
  const endpoint = process.env.BING_ENDPOINT || 'https://api.bing.microsoft.com/v7.0/search';

  if (!key) return [];

  const url = `${endpoint}?q=${encodeURIComponent(query)}&count=${maxResults}`;

  try {
    const res = await fetch(url, {
      timeout: timeoutMs,
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'User-Agent': 'HaloAI/1.0'
      }
    });

    if (!res.ok) {
      return [];
    }

    const json = await res.json();
    const items = (json.webPages && Array.isArray(json.webPages.value))
      ? json.webPages.value
      : [];

    return items.slice(0, maxResults).map(item => ({
      title: item.name || '',
      snippet: item.snippet || item.name || '',
      url: item.url || ''
    }));
  } catch {
    return [];
  }
}

module.exports = { bingSearch };
