// api/search/bing.js
const fetch = require("node-fetch");

module.exports = async function handler(req, res) {
  try {
    const { query, maxResults = 5 } = req.body || {};
    const key = process.env.BING_API_KEY;

    if (!key) return res.status(500).json({ error: "Missing BING_API_KEY" });
    if (!query) return res.status(400).json({ error: "Missing query" });

    const url =
      `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}`;

    const apiRes = await fetch(url, {
      headers: {
        "Ocp-Apim-Subscription-Key": key
      }
    });

    const json = await apiRes.json();
    const items = json.webPages?.value?.slice(0, maxResults) || [];

    const unified = items.map(i => ({
      title: i.name || "",
      snippet: i.snippet || "",
      url: i.url || "",
      provider: "bing"
    }));

    return res.status(200).json({ results: unified });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
