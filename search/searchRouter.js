// search/searchRouter.js
// Desktop unified search → calls Vercel backend only

const fetch = require("node-fetch");

async function unifiedWebSearch(query, maxResults = 5) {
  try {
    const res = await fetch("https://haloai-clean.vercel.app/api/search/router", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, maxResults })
    });

    const json = await res.json();

    if (json?.results) {
      return json.results;
    }

    return [];
  } catch (err) {
    console.error("[SearchRouter] Backend error:", err.message);
    return [];
  }
}

module.exports = { unifiedWebSearch };
