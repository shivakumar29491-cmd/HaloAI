// braveApi.js
// Thin wrapper around Brave Search API, returning normalized results.

const fetch = require('node-fetch');

class BraveApi {
  /**
   * @param {Object} opts
   * @param {string} [opts.apiKey]   - Brave API key (or BRAVE_API_KEY env)
   * @param {string} [opts.endpoint] - Override Brave endpoint for testing
   * @param {Function} [opts.log]    - Optional logger(msg) -> void
   */
  constructor(opts = {}) {
    this.apiKey   = opts.apiKey || process.env.BRAVE_API_KEY || '';
    this.endpoint = opts.endpoint || 'https://api.search.brave.com/res/v1/web/search';
    this.log      = typeof opts.log === 'function' ? opts.log : () => {};
  }

  /**
   * Perform a web search.
   * @param {string} query
   * @param {number} [maxResults=5]
   * @returns {Promise<Array<{title:string,url:string,snippet:string,source:string,provider:string}>>}
   */
  async search(query, maxResults = 5) {
    const q = String(query || '').trim();
    if (!q) return [];

    if (!this.apiKey) {
      this.log('[Brave] Missing BRAVE_API_KEY, skipping Brave search.');
      return [];
    }

    const url = new URL(this.endpoint);
    url.searchParams.set('q', q);
    url.searchParams.set('count', String(maxResults));   // Brave supports count param

    this.log(`[Brave] GET ${url.toString()}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'X-Subscription-Token': this.apiKey,
          'Accept': 'application/json'
        },
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.log(`[Brave] HTTP ${res.status} — ${text.slice(0, 200)}`);
        return [];
      }

      const json = await res.json().catch(() => null);
      if (!json || !json.web || !Array.isArray(json.web.results)) {
        this.log('[Brave] Unexpected response shape.');
        return [];
      }

      const items = json.web.results.slice(0, maxResults);

      const mapped = items.map(it => ({
        title:   it.title || it.description || '(no title)',
        url:     it.url || it.link || '',
        snippet: it.description || it.page_facts?.[0]?.text || '',
        source:  'brave',
        provider: 'brave'
      })).filter(x => x.url);

      this.log(`[Brave] ${mapped.length} result(s) returned.`);
      return mapped;

    } catch (e) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') {
        this.log('[Brave] Request timed out.');
      } else {
        this.log(`[Brave] Error: ${e.message}`);
      }
      return [];
    }
  }
}

module.exports = { BraveApi };
