// api/search/router.js
import fetch from 'node-fetch';

export default async function handler(req, res) {
  try {
    const { query, maxResults = 5 } = JSON.parse(req.body || '{}');

    if (!query || !query.trim()) {
      return res.status(400).json({ error: 'Missing query' });
    }

    // Providers (parallel)
    const endpoints = [
      { name: 'brave',    url: '/api/search/brave' },
      { name: 'bing',     url: '/api/search/bing' },
      { name: 'serpapi',  url: '/api/search/serpapi' },
      { name: 'googlePSE',url: '/api/search/googlePSE' },
      { name: 'groq',     url: '/api/search/groq' } // Quick-answer
    ];

    const base = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://haloai-clean.vercel.app';

    const calls = endpoints.map(ep =>
      fetch(`${base}${ep.url}`, {
        method: 'POST',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, maxResults })
      })
        .then(r => r.json())
        .then(j => j.results || [])
        .catch(() => [])
    );

    const results = await Promise.all(calls);

    const merged = results.flat().slice(0, maxResults * 4);

    return res.status(200).json({ results: merged });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
