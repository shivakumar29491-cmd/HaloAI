// -----------------------------------------------------------
//  groqEngine.js — LLM Answer Engine (ROOT FOLDER)
// -----------------------------------------------------------

const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });


// -----------------------------------------------------------
// 1. GROQ WHISPER TRANSCRIPTION
// -----------------------------------------------------------
async function groqWhisperTranscribe(audioBuffer) {
  try {
    const response = await groq.audio.transcriptions.create({
      file: {
        name: "audio.wav",
        mimeType: "audio/wav",
        buffer: audioBuffer,
      },
      model: "whisper-large-v3",
    });

    return response.text || "";
  } catch (err) {
    console.error("Groq Whisper Error:", err.message);
    return "";
  }
}


// -----------------------------------------------------------
// 2. FAST LLM ANSWER (MAIN AI ENGINE)
// -----------------------------------------------------------
// Recommended model: llama-3.1-8b-instant
async function groqFastAnswer(prompt) {
  try {
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "user", content: prompt }
      ],
      model: "llama-3.1-8b-instant",
      temperature: 0.2
    });

    return completion.choices?.[0]?.message?.content || "";
  } catch (err) {
    console.error("Groq LLaMA Error:", err.message);
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
