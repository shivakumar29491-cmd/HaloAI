// -----------------------------------------------------------
//  groqEngine.js — LLM Answer Engine (ROOT FOLDER)
//  Phase 8 — use HaloAI Backend (Vercel)
// -----------------------------------------------------------

const fetch = require("node-fetch");

// -----------------------------------------------------------
// 1. GROQ WHISPER TRANSCRIPTION  (via direct Groq API)
// -----------------------------------------------------------
const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function groqWhisperTranscribe(audioBuffer) {
  try {
    const response = await groq.audio.transcriptions.create({
      file: {
        name: "audio.wav",
        mimeType: "audio/wav",
        buffer: audioBuffer,
      },
      model: "whisper-large-v3"
    });

    return response.text || "";
  } catch (err) {
    console.error("Groq Whisper Error:", err.message);
    return "";
  }
}

// -----------------------------------------------------------
// 2. FAST ANSWER — USE HALOAI BACKEND (NOT GROQ DIRECT)
// -----------------------------------------------------------
async function groqFastAnswer(prompt) {
  try {
   const result = await groq.chat.completions.create({
  model: "llama-3.1-8b-instant",
  messages: [
    { role: "system", content: "You are HaloAI. Provide a direct, concise answer." },
    { role: "user", content: prompt }
  ],
  temperature: 0.2,
  max_tokens: 200
});

    const text = result.choices?.[0]?.message?.content || "";
    return text.trim();

  } catch (err) {
    console.error("Groq Direct API Error:", err.message);
    return "";
  }
}


// -----------------------------------------------------------
// EXPORTS
// -----------------------------------------------------------
module.exports = {
  groqWhisperTranscribe,
  groqFastAnswer
};
