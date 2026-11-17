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

  let adapterCatalog = Array.isArray(window.__aihubAdapterCatalog) ? window.__aihubAdapterCatalog : [];
  const adapterForHost = (host) => adapterCatalog.find(adapter =>
    (adapter.domains || []).some(domain => host === domain || host.endsWith("." + domain))
  ) || null;

  function inferRole(element, adapter) {
    const explicit = (element.getAttribute("data-message-author-role") || "").toLowerCase();
    const mapping = adapter?.roleMapping || {};
    if (mapping[explicit]) return mapping[explicit];
    if (explicit === "user" || explicit === "assistant") return explicit;
    const hint = [
      element.getAttribute("data-testid") || "",
      element.getAttribute("data-turn") || "",
      element.getAttribute("aria-label") || "",
      element.className?.toString?.() || ""
    ].join(" ").toLowerCase();
    if (/user|human|prompt|question/.test(hint)) return mapping.user || "user";
    if (/assistant|model|response|answer/.test(hint)) return mapping.assistant || "assistant";
    return "";
  }

  function detectAdapter() {
    const host = location.hostname.toLowerCase();
    const adapter = adapterForHost(host);
    if (!adapter) return { adapter: null, signatureMatches: 0, confidence: 0 };
    let signatureMatches = 0;
    for (const selector of adapter.domSignatures || []) {
      try { if (document.querySelector(selector)) signatureMatches++; } catch (_) {}
    }
    const confidence = (adapter.domSignatures || []).length === 0
      ? 0.7
      : Math.min(1, 0.7 + 0.3 * signatureMatches / adapter.domSignatures.length);
    return { adapter, signatureMatches, confidence };
  }

  // PyreCrawl-inspired extraction ladder: precise provider selectors first,
  // then conservative semantic/test-id fallbacks. Keep extraction in the live
  // WebView2 session so the user's existing sign-in cookies remain available.
  function identifyMessages() {
    const host = location.hostname.toLowerCase();
    const adapter = adapterForHost(host);
    if (adapter?.messageSelectors?.length) {
      const custom = [];
      for (const selector of adapter.messageSelectors) {
        try {
          document.querySelectorAll(selector).forEach(el => {
            const role = inferRole(el, adapter);
            if (role) custom.push({ el, role, strategy: "json-adapter" });
          });
        } catch (error) {
          diagnostic("adapter-selector-error", "JSON adapter contains an invalid CSS selector", { adapterId: adapter.id });
        }
      }
      if (custom.length) return custom;
    }
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
    // Cross-provider semantic fallback. It only accepts elements whose own
    // attributes identify a message role; it never scrapes arbitrary page text.
    const semantic = [...document.querySelectorAll(
      "[data-message-author-role], [data-testid*='message'], [data-testid*='turn'], [data-turn], [aria-label*='message' i]"
    )].map(el => {
      const explicit = (el.getAttribute("data-message-author-role") || "").toLowerCase();
      const hint = [
        el.getAttribute("data-testid") || "",
        el.getAttribute("data-turn") || "",
        el.getAttribute("aria-label") || "",
        el.getAttribute("data-message-author-role") || ""
      ].join(" ").toLowerCase();
      const role = explicit === "user" || explicit === "assistant" ? explicit
        : /user|human|prompt|question/.test(hint) ? "user"
        : /assistant|model|response|answer/.test(hint) ? "assistant" : "";
      return role ? { el, role, strategy: "semantic-fallback" } : null;
    }).filter(Boolean);
    return semantic;
  }

  function describeDomShape() {
    const count = selector => {
      try { return document.querySelectorAll(selector).length; } catch (_) { return -1; }
    };
    const testIds = [...new Set([...document.querySelectorAll("[data-testid]")]
      .map(el => el.getAttribute("data-testid"))
      .filter(Boolean))].slice(0, 35);
    const customTags = [...new Set([...document.querySelectorAll("*")]
      .map(el => el.tagName.toLowerCase())
      .filter(tag => tag.includes("-")))].slice(0, 25);
    const roles = [...new Set([...document.querySelectorAll("[role]")].map(el => el.getAttribute("role")).filter(Boolean))].slice(0, 20);
    return [
      "DOM-probe (без текста переписки):",
      "main=" + count("main"),
      "article=" + count("article"),
      "role=article=" + count('[role="article"]'),
      "data-testid=" + count("[data-testid]"),
      "data-message-author-role=" + count("[data-message-author-role]"),
      "data-turn=" + count("[data-turn]"),
      "testids=[" + testIds.join(", ") + "]",
      "customTags=[" + customTags.join(", ") + "]",
      "roles=[" + roles.join(", ") + "]"
    ].join(" | ");
  }

  function scan() {
    scans++;
    if (scans === 1) diagnostic("dom-probe", describeDomShape());
    const found = identifyMessages();
    const host = location.hostname.toLowerCase();
    const detection = detectAdapter();
    const supported = Boolean(detection.adapter) || found.some(item => item.strategy === "semantic-fallback");

    if (found.length !== lastFoundCount || scans === 1 || scans % 20 === 0) {
      lastFoundCount = found.length;
      diagnostic("scan", found.length
        ? "DOM-селекторы нашли элементы сообщений"
        : (supported ? "Поддерживаемый сайт открыт, но селекторы не нашли сообщения" : "Сайт пока не поддерживается"),
        { providerHost: host, adapterId: detection.adapter?.id || "generic", detectionConfidence: detection.confidence,
          signatureMatches: detection.signatureMatches, foundCount: found.length, scanCount: scans, supported,
          strategy: found[0]?.strategy || "none" });
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

  window.__aihubSetAdapterCatalog = (catalog) => {
    if (!Array.isArray(catalog)) return;
    adapterCatalog = catalog;
    diagnostic("adapter-catalog-loaded", "Загружен JSON-каталог адаптеров", { adapterCount: adapterCatalog.length });
    scan();
  };

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