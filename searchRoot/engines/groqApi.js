// =====================================================
// groqApi.js — Search Provider for Phase 8
// Makes Groq behave like Bing/Brave/SerpAPI
// =====================================================

const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function groqSearch(query, { maxResults = 5, timeoutMs = 2500 } = {}) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "user",
          content: `Give a concise web-style answer for this search query:\n"${query}"\nUse short sentences.`
        }
      ],
      model: "llama-3.1-8b-instant",
      temperature: 0.2,
      max_tokens: 120,
      signal: controller.signal
    });

    clearTimeout(timer);

    const text = completion.choices?.[0]?.message?.content || "";
    if (!text.trim()) return [];

    return [
      {
        title: `Groq Web Answer`,
        snippet: text.trim(),
        url: "",
      }
    ];

  } catch (err) {
    console.error("Groq Search Error:", err.message);
    return [];
  }
}

module.exports = {
  groqSearch
};
