// api/search/router.js (CLOUD-SAFE VERSION)
const fetch = require("node-fetch");

function safeJsonResponse(resp) {
  return resp.text().then((txt) => {
    try {
      return JSON.parse(txt);
    } catch {
      // HTML or non-JSON → Return empty results instead of exploding
      return { results: [] };
    }
  });
}

module.exports = async function handler(req, res) {
  try {
    const query = req.query.q || req.body?.query;
    const maxResults = Number(req.query.maxResults || req.body?.maxResults || 5);

    if (!query) {
      return res.status(400).json({ error: "Missing query" });
    }

    const endpoints = [
      { name: "brave", url: "/api/search/braveApi" },
      { name: "serpapi", url: "/api/search/serpapi" },
      { name: "googlePSE", url: "/api/search/googlePSE" },
      { name: "groq", url: "/api/search/groq" }
    ];

    const base = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

    const calls = endpoints.map((ep) =>
      fetch(`${base}${ep.url}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, maxResults })
      })
        .then((resp) => safeJsonResponse(resp))
        .then((json) => json.results || [])
        .catch((err) => {
          console.error(`Router: ${ep.name} failed →`, err.message);
          return [];
        })
    );

    const bundles = await Promise.all(calls);

    return res.status(200).json({
      results: bundles.flat().slice(0, maxResults * 4)
    });

  } catch (err) {
    console.error("Router fatal:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
