(() => {
  if (window.__aihubCaptureInstalled) {
    try { window.chrome.webview.postMessage(JSON.stringify({ type: "aihub-diagnostic", stage: "duplicate-install", detail: "CaptureScript уже был запущен в этом документе", url: location.href })); } catch (_) {}
    return;
  }
  window.__aihubCaptureInstalled = true;

  let sequence = 0;
  let scans = 0;
  let lastFoundCount = -1;
  const elementKeys = new WeakMap();
  const sentContent = new WeakMap();

  const diagnostic = (stage, detail, extra = {}) => {
    try {
      if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(JSON.stringify({
          type: "aihub-diagnostic", stage, detail, url: location.href,
          readyState: document.readyState, ...extra
        }));
      }
    } catch (_) {}
  };

  const cleanText = (element) => (element.innerText || element.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const hash = (value) => {
    let h = 2166136261;
    for (let i = 0; i < value.length; i++) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  };

  // PyreCrawl-inspired extraction ladder: precise provider selectors first,
  // then conservative semantic/test-id fallbacks. Keep extraction in the live
  // WebView2 session so the user's existing sign-in cookies remain available.
  function identifyMessages() {
    const host = location.hostname.toLowerCase();
    if (host.includes("chatgpt.com") || host.includes("openai.com")) {
      const exact = [...document.querySelectorAll("[data-message-author-role]")].map(el => ({
        el, role: el.getAttribute("data-message-author-role"), strategy: "provider"
      }));
      if (exact.length) return exact;
      const fallback = [...document.querySelectorAll('[data-testid*="conversation-turn"], [data-testid*="message"]')]
        .map(el => {
          const hint = ((el.getAttribute("data-testid") || "") + " " + (el.getAttribute("aria-label") || "")).toLowerCase();
          const role = hint.includes("user") ? "user" : hint.includes("assistant") || hint.includes("model") ? "assistant" : "";
          return role ? { el, role, strategy: "semantic-fallback" } : null;
        }).filter(Boolean);
      return fallback;
    }
    if (host.includes("claude.ai")) {
      const exact = [];
      document.querySelectorAll('[data-testid="user-message"]').forEach(el => exact.push({ el, role: "user", strategy: "provider" }));
      document.querySelectorAll(".font-claude-message").forEach(el => exact.push({ el, role: "assistant", strategy: "provider" }));
      if (exact.length) return exact;
      return [...document.querySelectorAll('[data-testid*="message"], [aria-label*="message" i]')]
        .map(el => {
          const hint = ((el.getAttribute("data-testid") || "") + " " + (el.getAttribute("aria-label") || "")).toLowerCase();
          const role = hint.includes("user") ? "user" : hint.includes("assistant") || hint.includes("response") ? "assistant" : "";
          return role ? { el, role, strategy: "semantic-fallback" } : null;
        }).filter(Boolean);
    }
    if (host.includes("gemini.google.com")) {
      const exact = [];
      document.querySelectorAll("user-query").forEach(el => exact.push({ el, role: "user", strategy: "provider" }));
      document.querySelectorAll("model-response").forEach(el => exact.push({ el, role: "assistant", strategy: "provider" }));
      if (exact.length) return exact;
      return [...document.querySelectorAll('[data-testid*="message"], [data-test-id*="message"], [aria-label*="message" i]')]
        .map(el => {
          const hint = ((el.getAttribute("data-testid") || el.getAttribute("data-test-id") || "") + " " + (el.getAttribute("aria-label") || "")).toLowerCase();
          const role = hint.includes("user") ? "user" : hint.includes("model") || hint.includes("assistant") || hint.includes("response") ? "assistant" : "";
          return role ? { el, role, strategy: "semantic-fallback" } : null;
        }).filter(Boolean);
    }
    return [];
  }

  function scan() {
    scans++;
    const found = identifyMessages();
    const host = location.hostname.toLowerCase();
    const supported = host.includes("chatgpt.com") || host.includes("openai.com") ||
      host.includes("claude.ai") || host.includes("gemini.google.com");

    if (found.length !== lastFoundCount || scans === 1 || scans % 20 === 0) {
      lastFoundCount = found.length;
      diagnostic("scan", found.length
        ? "DOM-селекторы нашли элементы сообщений"
        : (supported ? "Поддерживаемый сайт открыт, но селекторы не нашли сообщения" : "Сайт пока не поддерживается"),
        { providerHost: host, foundCount: found.length, scanCount: scans, supported, strategy: found[0]?.strategy || "none" });
    }

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
        if (!window.chrome || !window.chrome.webview) {
          diagnostic("bridge-missing", "Объект window.chrome.webview недоступен");
          return;
        }
        window.chrome.webview.postMessage(JSON.stringify({
          type: "aihub-message",
          providerHost: host,
          url: location.href,
          role,
          messageKey: key,
          text,
          capturedAt: new Date().toISOString()
        }));
        diagnostic("message-sent", "Сообщение отправлено в приложение", { role, textLength: text.length });
      } catch (error) {
        diagnostic("post-error", String(error));
      }
    });
  }

  const start = () => {
    diagnostic("script-start", "CaptureScript запущен");
    scan();
    if (!document.documentElement) {
      diagnostic("dom-missing", "document.documentElement пока отсутствует");
      return;
    }
    const observer = new MutationObserver(() => scan());
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    diagnostic("observer-start", "MutationObserver подключён");
    setInterval(scan, 1800);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
    diagnostic("waiting-dom", "Ожидание DOMContentLoaded");
  } else {
    start();
  }
})();