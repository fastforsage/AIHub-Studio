(() => {
  if (window.__aihubCaptureInstalled) return;
  window.__aihubCaptureInstalled = true;

  let sequence = 0;
  const elementKeys = new WeakMap();
  const sentContent = new WeakMap();

  const cleanText = (element) => (element.innerText || element.textContent || "")
    .replace(/\\u00a0/g, " ")
    .replace(/[ \\t]+\\n/g, "\\n")
    .replace(/\\n{3,}/g, "\\n\\n")
    .trim();

  const hash = (value) => {
    let h = 2166136261;
    for (let i = 0; i < value.length; i++) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  };

  function identifyMessages() {
    const host = location.hostname.toLowerCase();
    if (host.includes("chatgpt.com") || host.includes("openai.com")) {
      return [...document.querySelectorAll("[data-message-author-role]")].map(el => ({
        el, role: el.getAttribute("data-message-author-role")
      }));
    }
    if (host.includes("claude.ai")) {
      const items = [];
      document.querySelectorAll('[data-testid="user-message"]').forEach(el => items.push({ el, role: "user" }));
      document.querySelectorAll(".font-claude-message").forEach(el => items.push({ el, role: "assistant" }));
      return items;
    }
    if (host.includes("gemini.google.com")) {
      const items = [];
      document.querySelectorAll("user-query").forEach(el => items.push({ el, role: "user" }));
      document.querySelectorAll("model-response").forEach(el => items.push({ el, role: "assistant" }));
      return items;
    }
    return [];
  }

  function scan() {
    const found = identifyMessages();
    found.forEach(({ el, role }, index) => {
      const text = cleanText(el);
      if (!text || text.length < 2) return;
      let key = elementKeys.get(el);
      if (!key) {
        sequence += 1;
        key = role + "-" + index + "-" + hash(text.slice(0, 64)) + "-" + sequence;
        elementKeys.set(el, key);
      }
      if (sentContent.get(el) === text) return;
      sentContent.set(el, text);
      try {
        window.chrome.webview.postMessage(JSON.stringify({
          type: "aihub-message",
          providerHost: location.hostname,
          url: location.href,
          role,
          messageKey: key,
          text,
          capturedAt: new Date().toISOString()
        }));
      } catch (_) {}
    });
  }

  const start = () => {
    scan();
    const observer = new MutationObserver(() => scan());
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    setInterval(scan, 1800);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();