// api/search/googlePSE.js
const fetch = require("node-fetch");

module.exports = async function handler(req, res) {
  try {
    const { query, maxResults = 5 } = req.body || {};
    const key = process.env.GOOGLE_PSE_KEY;
    const cx = process.env.GOOGLE_PSE_CX;

    if (!key || !cx)
      return res.status(500).json({ error: "Missing GOOGLE_PSE_KEY or CX" });

    if (!query) return res.status(400).json({ error: "Missing query" });

    const base = "https://www.googleapis.com/customsearch/v1";
    const url =
      `${base}?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}` +
      `&q=${encodeURIComponent(query)}&num=${maxResults}`;

    const apiRes = await fetch(url);
    const json = await apiRes.json();

    const items = Array.isArray(json.items) ? json.items : [];

    const unified = items.slice(0, maxResults).map(item => ({
      title: item.title,
      snippet: item.snippet?.trim() || "",
      url: item.link || "",
      provider: "googlePSE"
    }));

    return res.status(200).json({ results: unified });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
