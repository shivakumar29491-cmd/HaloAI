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
    const res = await fetch("https://haloai-clean.vercel.app/api/chat/groq", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ prompt })
    });

    const json = await res.json();

    if (json?.answer) {
      return json.answer.trim();
    }

    if (json?.error) {
      console.error("Groq Backend Error:", json.error);
      return "";
    }

    return "";
  } catch (err) {
    console.error("Groq Backend Fetch Error:", err.message);
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
