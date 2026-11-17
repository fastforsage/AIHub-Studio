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
  const pendingContent = new WeakMap();
  const pendingTimers = new WeakMap();
  const pendingPreviousKeys = new WeakMap();
  const candidateDebugState = new WeakMap();
  const scriptVersion = "2026.11.17-chatgpt-api-dom-v4";
  let chatGptApiState = "unknown";
  let chatGptApiInFlight = false;
  let chatGptApiLastAttempt = 0;
  let chatGptApiConversationUrl = "";
  const apiSentContent = new Map();

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
  function extractApiMessageText(content) {
    if (!content || typeof content !== "object") return "";
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const textParts = parts.map(part => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object") {
        if (typeof part.text === "string") return part.text;
        if (typeof part.content === "string") return part.content;
      }
      return "";
    }).filter(Boolean);
    if (!textParts.length && typeof content.text === "string") textParts.push(content.text);
    return textParts.join("\n").replace(/\u00a0/g, " ").trim();
  }

  async function captureChatGptConversationApi() {
    if (location.hostname.toLowerCase() !== "chatgpt.com") return;
    const match = location.pathname.match(/^\/c\/([^/]+)/);
    if (!match) return;
    const conversationId = match[1];
    const conversationUrl = location.origin + "/c/" + conversationId;
    if (conversationUrl !== chatGptApiConversationUrl) {
      chatGptApiConversationUrl = conversationUrl;
      chatGptApiState = "unknown";
      chatGptApiLastAttempt = 0;
      apiSentContent.clear();
    }
    if (chatGptApiInFlight || Date.now() - chatGptApiLastAttempt < 8000) return;
    chatGptApiLastAttempt = Date.now();
    chatGptApiInFlight = true;
    const endpoint = location.origin + "/backend-api/conversation/" + encodeURIComponent(conversationId);
    const startedAt = Date.now();
    diagnostic("api-request", "Отправляю запрос истории ChatGPT", {
      conversationId, endpointPath: "/backend-api/conversation/{id}", method: "GET", credentials: "include",
      readyState: document.readyState, pageOrigin: location.origin
    });
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        credentials: "include",
        headers: { "Accept": "application/json" },
        cache: "no-store"
      });
      const contentType = response.headers.get("content-type") || "";
      const requestId = response.headers.get("x-request-id") || response.headers.get("oai-request-id") || "";
      const cfRay = response.headers.get("cf-ray") || "";
      if (!response.ok) {
        let bodyLength = 0;
        let bodyKind = "empty";
        let bodyTitle = "";
        try {
          const body = await response.clone().text();
          bodyLength = body.length;
          const trimmed = body.trim();
          if (trimmed.startsWith("<")) {
            bodyKind = "html";
            const title = trimmed.match(new RegExp("<title[^>]*>([^<]{0,160})</title>", "i"));
            bodyTitle = title ? title[1].replace(/\\s+/g, " ").trim() : "";
          } else if (trimmed) {
            try { const parsed = JSON.parse(trimmed); bodyKind = "json"; bodyTitle = Object.keys(parsed).slice(0, 12).join(","); }
            catch (_) { bodyKind = "text"; }
          }
        } catch (_) { bodyKind = "unreadable"; }
        chatGptApiState = "unavailable";
        diagnostic("api-response", "API вернул ошибочный HTTP-ответ", {
          apiStatus: response.status, contentType, redirected: response.redirected, responseUrl: response.url,
          elapsedMs: Date.now() - startedAt, bodyLength, bodyKind, bodyTitle, requestId, cfRay, conversationId
        });
        diagnostic("api-capture", "ChatGPT conversation endpoint вернул HTTP " + response.status + "; DOM fallback активирован", {
          apiStatus: response.status, conversationId, elapsedMs: Date.now() - startedAt
        });
        return;
      }
      diagnostic("api-response", "API вернул успешный HTTP-ответ", {
        apiStatus: response.status, contentType, redirected: response.redirected,
        elapsedMs: Date.now() - startedAt, requestId, cfRay, conversationId
      });
      const payload = await response.json();
      const mapping = payload && payload.mapping && typeof payload.mapping === "object" ? payload.mapping : null;
      if (!mapping) {
        chatGptApiState = "unavailable";
        diagnostic("api-payload", "HTTP успешен, но ожидаемая структура mapping отсутствует", {
          conversationId, topLevelKeys: Object.keys(payload || {}).slice(0, 30),
          hasCurrentNode: Boolean(payload && payload.current_node), hasMapping: Boolean(payload && payload.mapping)
        });
        diagnostic("api-capture", "Ответ endpoint не содержит mapping; переключаюсь на DOM", { conversationId });
        return;
      }
      diagnostic("api-payload", "Структура conversation API распознана", {
        conversationId, mappingNodes: Object.keys(mapping).length, currentNodePresent: Boolean(payload.current_node)
      });

      const ordered = [];
      const visited = new Set();
      let cursor = payload.current_node;
      while (cursor && mapping[cursor] && !visited.has(cursor)) {
        visited.add(cursor);
        const node = mapping[cursor];
        ordered.push(node);
        cursor = node.parent || null;
      }
      ordered.reverse();
      if (!ordered.length) {
        Object.values(mapping).filter(node => node && node.message)
          .sort((a, b) => (a.message.create_time || 0) - (b.message.create_time || 0))
          .forEach(node => ordered.push(node));
      }

      let captured = 0;
      for (const node of ordered) {
        const message = node && node.message;
        if (!message || !message.author) continue;
        const role = message.author.role;
        if (role !== "user" && role !== "assistant") continue;
        if (message.metadata?.is_visually_hidden_from_conversation === true) continue;
        if (role === "assistant" && message.recipient && message.recipient !== "all") continue;
        const contentType = message.content?.content_type || "";
        if (contentType !== "text" && contentType !== "multimodal_text") continue;
        const text = extractApiMessageText(message.content);
        if (!text || text.length < 2) continue;
        const messageKey = message.id || node.id;
        if (!messageKey) continue;
        if (apiSentContent.get(messageKey) === text) continue;
        apiSentContent.set(messageKey, text);
        window.chrome.webview.postMessage(JSON.stringify({
          type: "aihub-message",
          providerHost: "chatgpt.com",
          url: location.href,
          role,
          messageKey,
          text,
          capturedAt: new Date().toISOString(),
          extractionStrategy: "chatgpt-conversation-api"
        }));
        captured++;
      }
      chatGptApiState = "ready";
      diagnostic("api-capture", "История ChatGPT прочитана из авторизованной сессии", {
        conversationId, pathNodes: ordered.length, mappingNodes: Object.keys(mapping).length,
        messagesSent: captured, apiStatus: response.status, elapsedMs: Date.now() - startedAt
      });
    } catch (error) {
      chatGptApiState = "unavailable";
      diagnostic("api-capture", "Не удалось прочитать conversation API; использую DOM fallback", {
        error: String(error).slice(0, 180), conversationId
      });
    } finally {
      chatGptApiInFlight = false;
    }
  }

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
    if (host === "chatgpt.com" || host.endsWith(".openai.com")) {
      const timeline = document.querySelector('[data-app-action-timeline-scroll][role="region"]');
      const scope = timeline || document;
      let modernNodes = [...scope.querySelectorAll(
        '[data-content-search-unit-key$=":user"], [data-content-search-unit-key$=":assistant"]'
      )];
      if (!modernNodes.length) {
        modernNodes = [...scope.querySelectorAll(
          '[data-chatgpt-search-unit-key$=":user"], [data-chatgpt-search-unit-key$=":assistant"]'
        )];
      }
      if (!modernNodes.length) modernNodes = [...scope.querySelectorAll('[data-user-message-bubble="true"]')];
      const modern = modernNodes.map(el => {
        const unitKey = el.getAttribute("data-content-search-unit-key") ||
          el.getAttribute("data-chatgpt-search-unit-key") || "";
        const role = unitKey.endsWith(":user") || el.getAttribute("data-user-message-bubble") === "true"
          ? "user" : unitKey.endsWith(":assistant") ? "assistant" : "";
        return role ? { el, role, strategy: "chatgpt-app-shell-dom", stableKey: unitKey } : null;
      }).filter(Boolean);
      if (modern.length) return modern;

      const exact = [...document.querySelectorAll("[data-message-author-role]")].map(el => ({
        el, role: el.getAttribute("data-message-author-role"), strategy: "provider-legacy"
      })).filter(x => x.role === "user" || x.role === "assistant");
      if (exact.length) return exact;
      const fallback = [...document.querySelectorAll(
        '[data-testid*="conversation-turn"], [data-testid*="message"], [data-test-id*="message"], [data-turn], [aria-label*="message" i]'
      )].map(el => {
        const hint = [
          el.getAttribute("data-testid") || "",
          el.getAttribute("data-test-id") || "",
          el.getAttribute("data-turn") || "",
          el.getAttribute("aria-label") || "",
          el.getAttribute("data-message-author-role") || ""
        ].join(" ").toLowerCase();
        const explicit = (el.getAttribute("data-message-author-role") || "").toLowerCase();
        const role = explicit === "user" || explicit === "assistant" ? explicit
          : /(^|[^a-z])(user|human|prompt|question)([^a-z]|$)/.test(hint) ? "user"
          : /(^|[^a-z])(assistant|model|response|answer)([^a-z]|$)/.test(hint) ? "assistant" : "";
        return role ? { el, role, strategy: "semantic-fallback" } : null;
      }).filter(Boolean);
      if (fallback.length) return fallback;
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
        el.getAttribute("data-message-author-role") || "",
        el.getAttribute("data-author") || "",
        el.getAttribute("data-role") || ""
      ].join(" ").toLowerCase();
      const role = explicit === "user" || explicit === "assistant" ? explicit
        : /(^|[^a-z])(user|human|prompt|question)([^a-z]|$)/.test(hint) ? "user"
        : /(^|[^a-z])(assistant|model|response|answer)([^a-z]|$)/.test(hint) ? "assistant" : "";
      return role ? { el, role, strategy: "semantic-fallback" } : null;
    }).filter(Boolean);
    // Prefer leaf-most candidates to avoid saving a turn wrapper and its nested
    // message body as duplicate messages.
    const candidateSet = new Set(semantic.map(item => item.el));
    return semantic.filter(item => ![...item.el.querySelectorAll(
      "[data-message-author-role], [data-testid*='message'], [data-testid*='turn'], [data-turn], [aria-label*='message' i]"
    )].some(child => candidateSet.has(child)));
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
    const allElements = [...document.querySelectorAll("*")];
    const shadowRoots = allElements.filter(el => el.shadowRoot).length;
    const bodyTextLength = document.body ? (document.body.innerText || "").length : 0;
    return [
      "DOM-probe (без текста переписки):",
      "readyState=" + document.readyState,
      "topFrame=" + (window.top === window),
      "body=" + count("body"),
      "bodyChildren=" + (document.body?.children.length || 0),
      "bodyTextLength=" + bodyTextLength,
      "iframe=" + count("iframe,frame"),
      "contenteditable=" + count("[contenteditable='true']"),
      "openShadowRoots=" + shadowRoots,
      "main=" + count("main"),
      "timeline-region=" + count('[data-app-action-timeline-scroll][role="region"]'),
      "user-bubble=" + count('[data-user-message-bubble="true"]'),
      "content-unit-user=" + count('[data-content-search-unit-key$=":user"]'),
      "content-unit-assistant=" + count('[data-content-search-unit-key$=":assistant"]'),
      "search-unit=" + count("[data-chatgpt-search-unit-key]"),
      "turn-key=" + count("[data-turn-key]"),
      "test-id-hyphen=" + count("[data-test-id]"),
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
    // Refresh the structural probe after hydration; the first document-created\n    // scan often sees only the application shell. Never include message text.\n    if (scans === 1 || scans % 20 === 0) diagnostic("dom-probe", describeDomShape(), { scanCount: scans });
    const host = location.hostname.toLowerCase();
    const isChatGpt = host === "chatgpt.com";
    if (isChatGpt) void captureChatGptConversationApi();
    const found = isChatGpt && chatGptApiState !== "unavailable" ? [] : identifyMessages();
    const detection = detectAdapter();
    const supported = Boolean(detection.adapter) || found.some(item => item.strategy === "semantic-fallback") ||
      (isChatGpt && chatGptApiState === "ready");

    if (found.length !== lastFoundCount || scans === 1 || scans % 20 === 0) {
      lastFoundCount = found.length;
      diagnostic("scan", found.length
        ? "DOM-селекторы нашли элементы сообщений"
        : (supported ? "Поддерживаемый сайт открыт, но селекторы не нашли сообщения" : "Сайт пока не поддерживается"),
        { providerHost: host, adapterId: detection.adapter?.id || "generic", detectionConfidence: detection.confidence,
          signatureMatches: detection.signatureMatches, foundCount: found.length, scanCount: scans, supported,
          strategy: found[0]?.strategy || "none" });
    }

    found.forEach(({ el, role, strategy, stableKey }, index) => {
      const text = cleanText(el);
      const stableDomKey = stableKey || el.getAttribute("data-content-search-unit-key") ||
        el.getAttribute("data-chatgpt-search-unit-key") || el.getAttribute("data-turn-key") || "";
      const candidateSignature = [role, strategy || "unknown", text.length, hash(text), stableDomKey].join("|");
      if (candidateDebugState.get(el) !== candidateSignature) {
        candidateDebugState.set(el, candidateSignature);
        diagnostic("dom-candidate", "Обнаружен или изменился DOM-кандидат сообщения", {
          role, strategy: strategy || "unknown", index, textLength: text.length, contentHash: hash(text),
          stableKeyPresent: Boolean(stableDomKey), stableKey: stableDomKey.slice(0, 120),
          visible: Boolean(el.getClientRects().length), tagName: el.tagName.toLowerCase()
        });
      }
      if (!text || text.length < 2) {
        diagnostic("dom-skip", "DOM-кандидат пропущен: пустой или слишком короткий текст", {
          role, strategy: strategy || "unknown", index, textLength: text.length
        });
        return;
      }
      let key = elementKeys.get(el);
      let previousKey = "";
      if (!key) {
        sequence += 1;
        key = stableDomKey || ("dom-" + role + "-" + index + "-" + hash(text) + "-" + sequence);
        diagnostic("message-key", "Сформирован идентификатор DOM-сообщения", {
          role, strategy: strategy || "unknown", keySource: stableDomKey ? "provider-stable-key" : "dom-fallback",
          messageKey: key, index, contentHash: hash(text)
        });
        elementKeys.set(el, key);
      } else if (stableDomKey && key !== stableDomKey) {
        previousKey = key;
        key = stableDomKey;
        elementKeys.set(el, key);
        pendingPreviousKeys.set(el, previousKey);
        diagnostic("message-key-upgraded", "Временный ключ заменён стабильным ключом провайдера", {
          role, previousMessageKey: previousKey, messageKey: key, strategy: strategy || "unknown"
        });
      }
      if (sentContent.get(el) === text && !previousKey) return;
      if (pendingContent.get(el) === text && !previousKey) return;
      pendingContent.set(el, text);
      const existingTimer = pendingTimers.get(el);
      if (existingTimer) clearTimeout(existingTimer);
      if (previousKey) pendingPreviousKeys.set(el, previousKey);
      const timer = setTimeout(() => {
        pendingTimers.delete(el);
        const latestText = pendingContent.get(el);
        const latestKey = elementKeys.get(el);
        const oldKey = pendingPreviousKeys.get(el) || "";
        pendingPreviousKeys.delete(el);
        if (!latestText || !latestKey || (sentContent.get(el) === latestText && !oldKey)) return;
        try {
          if (!window.chrome || !window.chrome.webview) {
            diagnostic("bridge-missing", "Объект window.chrome.webview недоступен");
            return;
          }
          window.chrome.webview.postMessage(JSON.stringify({
            type: "aihub-message", providerHost: host, url: location.href, role,
            messageKey: latestKey, previousMessageKey: oldKey, text: latestText,
            extractionStrategy: strategy || "semantic-dom", capturedAt: new Date().toISOString()
          }));
          sentContent.set(el, latestText);
          diagnostic("message-sent", "Сообщение отправлено в приложение после debounce", {
            role, textLength: latestText.length, messageKey: latestKey, previousMessageKey: oldKey,
            strategy: strategy || "semantic-dom", contentHash: hash(latestText)
          });
        } catch (error) { diagnostic("post-error", String(error)); }
      }, 1200);
      pendingTimers.set(el, timer);
    });
  }


  // Button-triggered snapshot: collect structural metadata only; never include chat text.
  window.__aihubCollectDiagnostics = () => {
    const detection = detectAdapter();
    const candidates = identifyMessages().map(({ el, role, strategy, stableKey }, index) => {
      const text = cleanText(el);
      const key = stableKey || el.getAttribute("data-content-search-unit-key") ||
        el.getAttribute("data-chatgpt-search-unit-key") || el.getAttribute("data-turn-key") || "";
      return {
        index, role, strategy: strategy || "unknown", tagName: el.tagName.toLowerCase(),
        visible: Boolean(el.getClientRects().length), textLength: text.length,
        contentHash: hash(text), stableKeyPresent: Boolean(key),
        stableKey: key.slice(0, 160),
        elementKey: elementKeys.get(el) || null,
        candidateSent: sentContent.has(el)
      };
    });
    return {
      collectedAt: new Date().toISOString(), scriptVersion, href: location.origin +
        (location.pathname.startsWith("/c/") ? "/c/{conversation-id}" : location.pathname),
      readyState: document.readyState, providerHost: location.hostname,
      adapterId: detection.adapter?.id || "generic",
      detectionConfidence: detection.confidence, signatureMatches: detection.signatureMatches,
      scanCount: scans, apiState: chatGptApiState, apiInFlight: chatGptApiInFlight,
      apiLastAttemptAgeMs: chatGptApiLastAttempt ? Date.now() - chatGptApiLastAttempt : null,
      domShape: describeDomShape(), candidateCount: candidates.length, candidates
    };
  };

  window.__aihubSetAdapterCatalog = (catalog) => {
    if (!Array.isArray(catalog)) return;
    adapterCatalog = catalog;
    diagnostic("adapter-catalog-loaded", "Загружен JSON-каталог адаптеров", { adapterCount: adapterCatalog.length });
    scan();
  };

  const start = () => {
    diagnostic("script-start", "CaptureScript запущен", { scriptVersion });
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