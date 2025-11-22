// api/search/groq.js
const Groq = require("groq-sdk");

module.exports = async function handler(req, res) {
  console.log("---- [GROQ SEARCH] Incoming request ----");

  try {
    const { query, maxResults = 5 } = req.body || {};
    console.log("[GROQ SEARCH] Query:", query);

    const key = process.env.GROQ_API_KEY;
    console.log("[GROQ SEARCH] API Key exists:", !!key);

    if (!key) return res.status(500).json({ error: "Missing GROQ_API_KEY" });
    if (!query) return res.status(400).json({ error: "Missing query" });

    console.time("[GROQ SEARCH] Completion Time");

    const groq = new Groq({ apiKey: key });

    const completion = await groq.chat.completions.create({
      messages: [{
        role: "user",
        content: `Web-style quick answer for:\n"${query}"\nShort sentences only.`
      }],
      model: "llama-3.1-8b-instant",
      temperature: 0.2,
      max_tokens: 120
    });

    console.timeEnd("[GROQ SEARCH] Completion Time");

    const text = completion.choices?.[0]?.message?.content || "";
    console.log("[GROQ SEARCH] Raw response:", text);

    return res.status(200).json({
      results: [{
        title: "Groq Quick Answer",
        snippet: text.trim(),
        url: "",
        provider: "groq"
      }]
    });

  } catch (err) {
    console.error("[GROQ SEARCH] Error:", err);
    return res.status(500).json({ error: err.message });
  }
};
