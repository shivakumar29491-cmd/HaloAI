// ------------------ Helpers ------------------
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

const transcriptBox = $('#liveTranscript');
const answerBox = $('#liveAnswer');
const logBox = $('#liveLog');
const chatInput = $('#chatInput');
const chatSend = $('#chatSend');

// Append text to transcript
function appendTranscript(text) {
  transcriptBox.value += (transcriptBox.value ? "\n" : "") + text;
  transcriptBox.scrollTop = transcriptBox.scrollHeight;
}

// Append text to answer pane
function appendAnswer(text) {
  const entry = document.createElement('div');
  entry.className = 'answer-entry';
  entry.innerHTML = text.replace(/\n/g, "<br>");
  answerBox.appendChild(entry);
  answerBox.scrollTop = answerBox.scrollHeight;
}

// Append logs
function appendLog(t) {
  logBox.value += t + "\n";
  logBox.scrollTop = logBox.scrollHeight;
}

// ------------------ API CALLS ------------------

// Call Groq chat
async function askGroq(prompt) {
  try {
    const res = await fetch('/api/chat/groq', {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });

    const data = await res.json();
    return data.answer || JSON.stringify(data);

  } catch (err) {
    return "Groq error: " + err.message;
  }
}

// Call Search Engines (router logic)
async function askSearch(prompt) {
  try {
    const res = await fetch(`/api/search/router?q=${encodeURIComponent(prompt)}`);
    const data = await res.json();
    return data?.answer || JSON.stringify(data);
  } catch (e) {
    return "Search error: " + e.message;
  }
}

// ------------------ Unified Ask ------------------
async function unifiedAsk(prompt) {
  appendTranscript("You: " + prompt);

  // 1) Try Groq fast
  const g = await askGroq(prompt);
  if (g && g.trim()) {
    appendAnswer(g);
    return;
  }

  // 2) Search fallback
  const web = await askSearch(prompt);
  appendAnswer(web);
}

// ------------------ UI Events ------------------
on(chatInput, "keydown", (e) => {
  if (e.key === "Enter") {
    const t = chatInput.value.trim();
    if (t) unifiedAsk(t);
    chatInput.value = "";
  }
});

on(chatSend, "click", () => {
  const t = chatInput.value.trim();
  if (t) unifiedAsk(t);
  chatInput.value = "";
});

// ------------------ Tabs ------------------
(function wireTabs(){
  const tabs = $$(".tab");
  const panels = {
    live: $("#tab-live"),
    logs: $("#tab-logs")
  };

  tabs.forEach(t => on(t, "click", () => {
    tabs.forEach(x => x.classList.remove("active"));
    t.classList.add("active");

    Object.values(panels).forEach(p => p.classList.remove("show"));
    panels[t.dataset.tab].classList.add("show");
  }));
})();
