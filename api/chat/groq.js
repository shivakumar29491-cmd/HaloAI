// api/chat/groq.js
const Groq = require("groq-sdk");

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { prompt } = req.body || {};
    const key = process.env.GROQ_API_KEY;

    if (!key) return res.status(500).json({ error: "Missing GROQ_API_KEY" });
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });

    const groq = new Groq({ apiKey: key });

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.1-8b-instant",
      temperature: 0.2,
      max_tokens: 500
    });

    const text = completion.choices?.[0]?.message?.content || "";
    return res.status(200).json({ answer: text.trim() });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
