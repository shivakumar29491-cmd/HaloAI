// =====================================================
// intentClassifier.js — Phase 8
// Determines if query should go Web-first, Doc-first, or Hybrid
// =====================================================

/**
 * Rules:
 * - Stock tickers, numbers, finance, prices → WEB
 * - "who", "what", "when", "current", "latest" → WEB
 * - Long-form reasoning → HYBRID
 * - Reference to uploaded PDF/doc → DOC_FIRST
 */

function classifyIntent(prompt) {
  if (!prompt) return "WEB";

  const p = prompt.toLowerCase();

  // --- Strong WEB indicators ----
  const webWords = [
    "price", "today", "current", "latest", "stock", "market",
    "nvda", "tsla", "aapl", "meta",
    "weather", "news", "headline",
    "google", "bing", "search"
  ];
  if (webWords.some(w => p.includes(w))) {
    return "WEB";
  }

  // --- Strong DOC-first indicators ---
  if (p.includes("in this document") || p.includes("from the pdf") || p.includes("summarize this")) {
    return "DOC";
  }

  // Default to hybrid
  return "HYBRID";
}

module.exports = {
  classifyIntent
};
