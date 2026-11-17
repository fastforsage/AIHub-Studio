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
        { providerHost: host, foundCount: found.length, scanCount: scans, supported });
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