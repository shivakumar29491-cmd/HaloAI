// =====================================================
// webRaceEngine.js — Phase 8
// Runs all search engines in parallel and returns fastest result
// =====================================================

const searchRouter = require('./search/searchRouter');
const { recordSuccess, recordError } = require('./providerStats');

/**
 * Race logic:
 * - Fire all providers at once
 * - Whichever provider returns first with a valid answer wins
 * - Record provider stats
 */
async function webRace(prompt) {
  const startTime = Date.now();

  const providers = [
    "bing",
    "googlePSE",
    "serpapi",
    "brave",
    "groq"
  ];

  const tasks = providers.map(provider => {
    return searchRouter.queryProvider(provider, prompt)
      .then(result => ({ provider, result }))
      .catch(err => ({ provider, error: err }));
  });

  while (tasks.length > 0) {
    const first = await Promise.race(tasks);

    if (first && first.result && first.result.answer) {
      const latency = Date.now() - startTime;
      recordSuccess(first.provider, latency);

      return {
        provider: first.provider,
        answer: first.result.answer,
        raw: first.result
      };
    }

    // Error path
    if (first.error) {
      recordError(first.provider);
    }
  }

  return {
    provider: null,
    answer: "No provider returned a valid result.",
    raw: null
  };
}

module.exports = {
  webRace
};
