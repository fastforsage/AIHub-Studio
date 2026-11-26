import { FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import type {
  AddLocalApiInput,
  AddWebsiteInput,
  CatalogState,
  Provider,
  ProviderUpdate
} from "../../catalog/catalogModel";
import { POPULAR_PROVIDER_IDS } from "../../catalog/catalogDefaults";
import type { BrowserManagerState } from "../../browser/browserTypes";
import type { LocalChatMessage } from "../../local-ai/localAiManager";
import { formatBuildLabel } from "../../shared/versionLabel";
import { buildWorkspaceTabs, type WorkspaceTab } from "../../shared/workspaceTabs";
import { getInitiallyExpandedCategories, toggleExpandedCategory } from "../../shared/catalogNavigation";
import type { DiagnosticsStatus, LogEntry, LogLevel, LoggingSettings } from "../../shared/diagnosticsApi";
import type { AvailabilityStatus, ServiceAvailabilityReport } from "../../shared/availabilityApi";
import type { TranslationReport } from "../../shared/translationApi";
import type { CatalogSyncReport } from "../../shared/catalogApi";
import { ProviderBrandIcon } from "./components/ProviderBrandIcon";

type MenuTarget =
  | { kind: "root" }
  | { kind: "category"; id: string }
  | { kind: "provider"; id: string };

type ContextMenuState = { x: number; y: number; target: MenuTarget } | null;

type ModalState =
  | { kind: "category-add" }
  | { kind: "category-edit"; id: string }
  | { kind: "website-add"; categoryId?: string }
  | { kind: "local-add"; categoryId?: string }
  | { kind: "provider-edit"; id: string }
  | null;

const EMPTY_CATALOG: CatalogState = {
  version: 1,
  categories: [
    { id: "chatbot", name: "chatbot" },
    { id: "music-generator", name: "music generator" },
    { id: "voice-generator", name: "voice generator" },
    { id: "video-generator", name: "video generator" },
    { id: "writing-helper", name: "writing helper" },
    { id: "research-assistant", name: "research assistant" },
    { id: "translator", name: "translator" },
    { id: "presentation-maker", name: "presentation maker" },
    { id: "image-generator", name: "image generator" },
    { id: "many-in-one", name: "many in one" },
    { id: "api-providers", name: "API providers and aggregators" },
    { id: "local-ai", name: "Local AI" }
  ],
  providers: []
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected application error";
}

function availabilityLabel(status: AvailabilityStatus): string {
  switch (status) {
    case "available": return "Доступен";
    case "slow": return "Медленно";
    case "protected": return "Защита / вход";
    case "regional-restriction": return "Региональное ограничение";
    case "unavailable": return "Недоступен";
  }
}

function App() {
  const catalogApi = window.aihub?.catalog;
  const browserApi = window.aihub?.browser;
  const localAiApi = window.aihub?.localAi;
  const diagnosticsApi = window.aihub?.diagnostics;
  const availabilityApi = window.aihub?.availability;
  const translationApi = window.aihub?.translation;
  const browserViewportRef = useRef<HTMLDivElement>(null);
  const settingsReturnMode = useRef<"catalog" | "browser" | "local-chat">("catalog");
  const [catalog, setCatalog] = useState<CatalogState>(EMPTY_CATALOG);
  const [catalogSelection, setCatalogSelection] = useState<string[]>([]);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogSaving, setCatalogSaving] = useState(false);
  const [catalogSyncBusy, setCatalogSyncBusy] = useState(false);
  const [catalogSyncReport, setCatalogSyncReport] = useState<CatalogSyncReport | null>(null);
  const [activeCategory, setActiveCategory] = useState("all");
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<string[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [menu, setMenu] = useState<ContextMenuState>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formHost, setFormHost] = useState("localhost");
  const [formPort, setFormPort] = useState("11434");
  const [formCategoryIds, setFormCategoryIds] = useState<string[]>(["chatbot"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [browserState, setBrowserState] = useState<BrowserManagerState>({ tabs: [], activeTabId: null });
  const [workspaceMode, setWorkspaceMode] = useState<"catalog" | "browser" | "settings" | "local-chat">("catalog");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [availabilityReport, setAvailabilityReport] = useState<ServiceAvailabilityReport | null>(null);
  const [translationOpen, setTranslationOpen] = useState(false);
  const [translationBusy, setTranslationBusy] = useState(false);
  const [translationAuto, setTranslationAuto] = useState(false);
  const [translationReport, setTranslationReport] = useState<TranslationReport | null>(null);
  const [translationNotice, setTranslationNotice] = useState("Перевод выполняется локально на этом устройстве.");
  const [localChatProviderId, setLocalChatProviderId] = useState<string | null>(null);
  const [openLocalTabIds, setOpenLocalTabIds] = useState<string[]>([]);
  const [localChats, setLocalChats] = useState<Record<string, LocalChatMessage[]>>({});
  const [localChatDraft, setLocalChatDraft] = useState("");
  const [localSending, setLocalSending] = useState(false);
  const [discoveringProviderId, setDiscoveringProviderId] = useState<string | null>(null);
  const [proxyServer, setProxyServer] = useState("");
  const [proxySaving, setProxySaving] = useState(false);
  const [proxyNotice, setProxyNotice] = useState<string | null>(null);
  const [loggingSettings, setLoggingSettings] = useState<LoggingSettings>({
    level: "info", fileEnabled: true, maxFileSizeMb: 10, maxFiles: 7, retentionDays: 7
  });
  const [diagnosticsStatus, setDiagnosticsStatus] = useState<DiagnosticsStatus | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [logFilter, setLogFilter] = useState<LogLevel | "all">("all");
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);

  useEffect(() => {
    if (!diagnosticsApi) return;
    const onWindowError = (event: ErrorEvent) => {
      const details = [event.message, event.filename, event.lineno ? "line " + event.lineno : ""].filter(Boolean).join(" · ");
      void diagnosticsApi.writeLog("error", "renderer", details).catch(() => undefined);
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const details = reason instanceof Error
        ? reason.name + ": " + reason.message + (reason.stack ? "\n" + reason.stack : "")
        : typeof reason === "string" ? reason : JSON.stringify(reason);
      void diagnosticsApi.writeLog("error", "renderer", "Unhandled promise rejection: " + details).catch(() => undefined);
    };
    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, [diagnosticsApi]);

  useEffect(() => {
    let cancelled = false;
    if (!catalogApi) {
      setError("The secure catalog bridge is unavailable. Restart the application.");
      return () => { cancelled = true; };
    }
    catalogApi.get().then((state) => {
      if (!cancelled) {
        setCatalog(state);
        setCatalogSelection(state.providers.filter((provider) => provider.enabled).map((provider) => provider.id));
        setExpandedCategoryIds(getInitiallyExpandedCategories(state.categories, state.providers));
        setError(null);
      }
    }).catch((reason: unknown) => {
      if (!cancelled) setError(errorMessage(reason));
    });
    return () => { cancelled = true; };
  }, [catalogApi]);

  useEffect(() => {
    if (workspaceMode !== "settings" || !diagnosticsApi) return;
    let mounted = true;
    Promise.all([diagnosticsApi.getStatus(), diagnosticsApi.getRecentLogs(200, logFilter)])
      .then(([status, entries]) => {
        if (!mounted) return;
        setDiagnosticsStatus(status);
        setLoggingSettings(status.settings);
        setLogEntries(entries);
      })
      .catch((reason: unknown) => {
        if (mounted) setError(errorMessage(reason));
      });
    return () => { mounted = false; };
  }, [workspaceMode, diagnosticsApi]);

  useEffect(() => {
    if (workspaceMode !== "settings" || !diagnosticsApi) return;
    let mounted = true;
    diagnosticsApi.getRecentLogs(200, logFilter)
      .then((entries) => { if (mounted) setLogEntries(entries); })
      .catch((reason: unknown) => { if (mounted) setError(errorMessage(reason)); });
    return () => { mounted = false; };
  }, [workspaceMode, diagnosticsApi, logFilter]);

  useEffect(() => {
    if (!browserApi) return;
    let mounted = true;
    const unsubscribe = browserApi.onChanged((state) => {
      if (mounted) setBrowserState(state);
    });
    browserApi.get().then((state) => {
      if (mounted) setBrowserState(state);
    }).catch((reason: unknown) => {
      if (mounted) setError(errorMessage(reason));
    });
    browserApi.getProxyServer().then((value) => {
      if (mounted) setProxyServer(value ?? "");
    }).catch((reason: unknown) => {
      if (mounted) setError(errorMessage(reason));
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [browserApi]);

  useEffect(() => {
    if (!browserApi) return;
    const viewport = workspaceMode === "browser" ? browserViewportRef.current : null;
    if (!viewport) {
      void browserApi.setViewportBounds({ x: 0, y: 0, width: 0, height: 0 }).catch(() => undefined);
      return;
    }

    const updateBounds = () => {
      const rect = viewport.getBoundingClientRect();
      void browserApi.setViewportBounds({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      }).catch((reason: unknown) => setError(errorMessage(reason)));
    };

    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    observer.observe(viewport);
    window.addEventListener("resize", updateBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateBounds);
    };
  }, [browserApi, workspaceMode, browserState.activeTabId, browserState.tabs.length]);

  const selectedProvider = catalog.providers.find((provider) => provider.id === selectedProviderId) ?? null;
  const modalProvider = modal?.kind === "provider-edit" ? catalog.providers.find((provider) => provider.id === modal.id) ?? null : null;
  const contextProviderId = menu && menu.target.kind === "provider" ? menu.target.id : null;
  const contextProvider = contextProviderId ? catalog.providers.find((provider) => provider.id === contextProviderId) ?? null : null;
  const activeBrowserTab = browserState.tabs.find((tab) => tab.id === browserState.activeTabId) ?? null;
  const localProviderCandidate = localChatProviderId
    ? catalog.providers.find((item) => item.id === localChatProviderId)
    : undefined;
  const activeLocalProvider = localProviderCandidate?.type === "local-api"
    ? localProviderCandidate
    : null;
  const activeLocalMessages = localChatProviderId ? localChats[localChatProviderId] ?? [] : [];
  const workspaceTabs = useMemo(
    () => buildWorkspaceTabs(browserState.tabs, catalog.providers, openLocalTabIds),
    [browserState.tabs, catalog.providers, openLocalTabIds]
  );
  const activeWorkspaceTabKey = workspaceMode === "settings" && settingsOpen
    ? "settings"
    : workspaceMode === "browser" && activeBrowserTab
      ? "website:" + activeBrowserTab.id
      : workspaceMode === "local-chat" && localChatProviderId
        ? "local:" + localChatProviderId
        : null;
  const availabilityByProviderId = useMemo(
    () => new Map((availabilityReport?.results ?? []).map((result) => [result.providerId, result] as const)),
    [availabilityReport]
  );
  const availabilitySummary = availabilityReport ? {
    available: availabilityReport.results.filter((item) => item.status === "available" || item.status === "slow").length,
    protected: availabilityReport.results.filter((item) => item.status === "protected").length,
    restricted: availabilityReport.results.filter((item) => item.status === "regional-restriction").length,
    unavailable: availabilityReport.results.filter((item) => item.status === "unavailable").length
  } : null;
  const visibleProviders = useMemo(() => {
    const enabledProviders = catalog.providers.filter((provider) => provider.enabled);
    if (activeCategory === "favorites") return enabledProviders.filter((provider) => provider.favorite);
    if (activeCategory === "all") return enabledProviders;
    return enabledProviders.filter((provider) => provider.categoryIds.includes(activeCategory));
  }, [catalog, activeCategory]);

  const activeCategoryName = activeCategory === "all"
    ? "All AI"
    : activeCategory === "favorites"
      ? "Favorites"
      : catalog.categories.find((category) => category.id === activeCategory)?.name ?? "All AI";

  async function commit(operation: () => Promise<CatalogState>): Promise<void> {
    if (!catalogApi || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await operation();
      const changedOpenWebsiteIds = browserState.tabs.flatMap((tab) => {
        const previous = catalog.providers.find((provider) => provider.id === tab.providerId);
        const updated = next.providers.find((provider) => provider.id === tab.providerId);
        return previous?.type === "website" && updated?.type === "website" &&
          previous.url !== updated.url ? [updated.id] : [];
      });
      const newlyAddedProviders = next.providers.filter((provider) =>
        !catalog.providers.some((existing) => existing.id === provider.id)
      );
      if (newlyAddedProviders.length > 0) {
        setExpandedCategoryIds((current) => [...new Set([
          ...current,
          ...newlyAddedProviders.flatMap((provider) => provider.categoryIds)
        ])]);
      }
      setCatalog(next);
      setCatalogSelection(next.providers.filter((provider) => provider.enabled).map((provider) => provider.id));
      if (browserApi && changedOpenWebsiteIds.length > 0) {
        for (const providerId of changedOpenWebsiteIds) {
          try {
            setBrowserState(await browserApi.openWebsite(providerId));
          } catch (browserReason) {
            setError("Connection was saved, but the open tab could not be refreshed: " + errorMessage(browserReason));
          }
        }
      }
      setModal(null);
      setMenu(null);
      setNotice("Changes saved");
      if (selectedProviderId && !next.providers.some((provider) => provider.id === selectedProviderId)) {
        setSelectedProviderId(null);
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  function openSettings(): void {
    if (workspaceMode !== "settings") settingsReturnMode.current = workspaceMode;
    setCatalogSelection(catalog.providers.filter((provider) => provider.enabled).map((provider) => provider.id));
    setCatalogSearch("");
    setSettingsOpen(true);
    setWorkspaceMode("settings");
  }

  function closeSettings(): void {
    setSettingsOpen(false);
    if (workspaceMode === "settings") setWorkspaceMode(settingsReturnMode.current);
  }

  async function syncCatalogNow(): Promise<void> {
    if (!catalogApi || catalogSyncBusy) return;
    setCatalogSyncBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await catalogApi.sync();
      setCatalog(result.catalog);
      setCatalogSelection(result.catalog.providers.filter((provider) => provider.enabled).map((provider) => provider.id));
      setCatalogSyncReport(result.report);
      setNotice("Каталог обновлён: добавлено " + result.report.added + ", обновлено " + result.report.updated + ".");
    } catch (reason) {
      setError("Не удалось обновить каталог: " + errorMessage(reason));
    } finally {
      setCatalogSyncBusy(false);
    }
  }

  async function checkCatalogAvailability(): Promise<void> {
    if (!availabilityApi || availabilityBusy) return;
    setAvailabilityBusy(true);
    setError(null);
    setNotice(null);
    try {
      const report = await availabilityApi.checkCatalog();
      setAvailabilityReport(report);
      const usable = report.results.filter((item) => item.status === "available" || item.status === "slow").length;
      setNotice("Проверка завершена: " + usable + " из " + report.results.length + " сайтов отвечают.");
    } catch (reason) {
      setError("Не удалось проверить доступность AI-сервисов: " + errorMessage(reason));
    } finally {
      setAvailabilityBusy(false);
    }
  }

  function openModal(next: Exclude<ModalState, null>): void {
    setMenu(null);
    setError(null);
    setNotice(null);
    setModal(next);

    if (next.kind === "category-add") {
      setFormName("");
      setFormCategoryIds([]);
    } else if (next.kind === "category-edit") {
      setFormName(catalog.categories.find((item) => item.id === next.id)?.name ?? "");
      setFormCategoryIds([]);
    } else if (next.kind === "website-add") {
      setFormName("");
      setFormUrl("");
      setFormCategoryIds([next.categoryId ?? "chatbot"]);
    } else if (next.kind === "local-add") {
      setFormName("Local LLM");
      setFormHost("localhost");
      setFormPort("11434");
      setFormCategoryIds([next.categoryId ?? "local-ai"]);
    } else {
      const provider = catalog.providers.find((item) => item.id === next.id);
      if (!provider) return;
      setFormName(provider.name);
      setFormCategoryIds([...provider.categoryIds]);
      if (provider.type === "website") {
        setFormUrl(provider.url);
      } else {
        setFormHost(provider.host);
        setFormPort(String(provider.port));
      }
    }
  }

  function showContextMenu(event: MouseEvent, target: MenuTarget): void {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: Math.min(event.clientX, window.innerWidth - 220), y: Math.min(event.clientY, window.innerHeight - 270), target });
  }

  function submitModal(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!modal) return;

    if (modal.kind === "category-add") {
      void commit(() => catalogApi!.addCategory(formName));
      return;
    }
    if (modal.kind === "category-edit") {
      void commit(() => catalogApi!.renameCategory(modal.id, formName));
      return;
    }
    if (modal.kind === "website-add") {
      const input: AddWebsiteInput = { name: formName, url: formUrl, categoryIds: formCategoryIds };
      void commit(() => catalogApi!.addWebsite(input));
      return;
    }
    if (modal.kind === "local-add") {
      const port = Number(formPort);
      const input: AddLocalApiInput = {
        name: formName,
        apiType: "openai",
        host: formHost,
        port,
        categoryIds: formCategoryIds
      };
      void commit(() => catalogApi!.addLocalApi(input));
      return;
    }

    const provider = catalog.providers.find((item) => item.id === modal.id);
    if (!provider) return;
    const update: ProviderUpdate = provider.type === "website"
      ? { type: "website", name: formName, url: formUrl, categoryIds: formCategoryIds }
      : { type: "local-api", name: formName, host: formHost, port: Number(formPort), categoryIds: formCategoryIds };
    void commit(() => catalogApi!.updateProvider(provider.id, update));
  }

  function invokeMenuAction(action: string): void {
    if (!menu) return;
    const target = menu.target;
    if (action === "category-add") openModal({ kind: "category-add" });
    else if (action === "website-add") openModal({ kind: "website-add", categoryId: target.kind === "category" ? target.id : undefined });
    else if (action === "local-add") openModal({ kind: "local-add", categoryId: target.kind === "category" ? target.id : undefined });
    else if (action === "category-edit" && target.kind === "category") openModal({ kind: "category-edit", id: target.id });
    else if (action === "provider-edit" && target.kind === "provider") openModal({ kind: "provider-edit", id: target.id });
    else if (action === "favorite" && target.kind === "provider") {
      const provider = catalog.providers.find((item) => item.id === target.id);
      if (provider) void commit(() => catalogApi!.setFavorite(provider.id, !provider.favorite));
      setMenu(null);
    } else if (action === "category-delete" && target.kind === "category") {
      const category = catalog.categories.find((item) => item.id === target.id);
      const count = catalog.providers.filter((item) => item.categoryIds.includes(target.id)).length;
      if (category && window.confirm("Delete category " + category.name + "? " + count + " connection(s) will be kept in All AI.")) {
        void commit(() => catalogApi!.deleteCategory(target.id));
        if (activeCategory === target.id) setActiveCategory("all");
      } else {
        setMenu(null);
      }
    } else if (action === "provider-delete" && target.kind === "provider") {
      const provider = catalog.providers.find((item) => item.id === target.id);
      if (provider && window.confirm("Remove " + provider.name + " from the catalog?")) {
        void commit(() => catalogApi!.deleteProvider(target.id));
      } else {
        setMenu(null);
      }
    }
  }

  function toggleCategory(id: string): void {
    setFormCategoryIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  async function refreshLocalModels(providerId: string): Promise<void> {
    if (!localAiApi || discoveringProviderId) return;
    setDiscoveringProviderId(providerId);
    setError(null);
    setNotice(null);
    try {
      const next = await localAiApi.discoverModels(providerId);
      setCatalog(next);
      const provider = next.providers.find((item) => item.id === providerId);
      setNotice(provider?.type === "local-api"
        ? provider.models.length + " model(s) discovered"
        : "Model discovery completed");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setDiscoveringProviderId(null);
    }
  }

  async function openLocalChat(provider: Provider): Promise<void> {
    if (provider.type !== "local-api") return;
    setSelectedProviderId(provider.id);
    setLocalChatProviderId(provider.id);
    setOpenLocalTabIds((current) => current.includes(provider.id) ? current : [...current, provider.id]);
    setLocalChatDraft("");
    setWorkspaceMode("local-chat");
    setError(null);
    if (provider.models.length === 0) {
      await refreshLocalModels(provider.id);
    }
  }

  async function chooseLocalModel(providerId: string, modelId: string): Promise<void> {
    if (!localAiApi) return;
    try {
      const next = await localAiApi.selectModel(providerId, modelId);
      setCatalog(next);
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function sendLocalMessage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!localAiApi || !activeLocalProvider || localSending || !activeLocalProvider.selectedModel) return;
    const text = localChatDraft.trim();
    if (!text) return;

    const previous = localChats[activeLocalProvider.id] ?? [];
    const history = [...previous, { role: "user" as const, content: text }].slice(-100);
    setLocalChats((current) => ({ ...current, [activeLocalProvider.id]: history }));
    setLocalChatDraft("");
    setLocalSending(true);
    setError(null);

    try {
      const result = await localAiApi.completeChat(activeLocalProvider.id, history);
      setLocalChats((current) => ({
        ...current,
        [activeLocalProvider.id]: [...(current[activeLocalProvider.id] ?? history), {
          role: "assistant" as const,
          content: result.content
        }].slice(-100)
      }));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLocalSending(false);
    }
  }

  function clearLocalChat(): void {
    if (!localChatProviderId) return;
    setLocalChats((current) => ({ ...current, [localChatProviderId]: [] }));
    setError(null);
  }


  async function translateActivePage(): Promise<void> {
    if (!translationApi || !activeBrowserTab || translationBusy) return;
    setTranslationBusy(true);
    setError(null);
    try {
      const report = await translationApi.translatePage(activeBrowserTab.id);
      setTranslationReport(report);
      setTranslationNotice(report.translatedNodes > 0
        ? `Переведено текстовых блоков: ${report.translatedNodes}`
        : "Подходящий для перевода текст не найден.");
    } catch (reason) {
      setError("Ошибка перевода Bergamot: " + errorMessage(reason));
    } finally {
      setTranslationBusy(false);
    }
  }

  async function restoreOriginalPage(): Promise<void> {
    if (!translationApi || !activeBrowserTab) return;
    try {
      await translationApi.restoreOriginalPage(activeBrowserTab.id);
      setTranslationReport(null);
      setTranslationNotice("Показан оригинал страницы.");
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  useEffect(() => {
    setTranslationReport(null);
    setTranslationNotice("Перевод выполняется локально на этом устройстве.");
  }, [activeBrowserTab?.id, activeBrowserTab?.url]);

  useEffect(() => {
    if (!translationAuto || workspaceMode !== "browser" || !activeBrowserTab || activeBrowserTab.loading) return;
    if (translationReport) return;
    void translateActivePage();
  }, [translationAuto, workspaceMode, activeBrowserTab?.id, activeBrowserTab?.loading, translationReport]);

  async function runBrowserAction(operation: () => Promise<BrowserManagerState>): Promise<void> {
    try {
      const next = await operation();
      setBrowserState(next);
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function openWebsite(provider: Provider): Promise<void> {
    if (provider.type !== "website" || !browserApi) return;
    setError(null);
    try {
      const next = await browserApi.openWebsite(provider.id);
      setBrowserState(next);
      setSelectedProviderId(provider.id);
      setWorkspaceMode("browser");
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function saveCatalogSelection(): Promise<void> {
    if (!catalogApi || catalogSaving) return;
    setCatalogSaving(true);
    setError(null);
    setNotice(null);
    try {
      const next = await catalogApi.setEnabledProviders(catalogSelection);
      setCatalog(next);
      setCatalogSelection(next.providers.filter((provider) => provider.enabled).map((provider) => provider.id));
      setExpandedCategoryIds(getInitiallyExpandedCategories(next.categories, next.providers.filter((provider) => provider.enabled)));
      if (selectedProviderId && !next.providers.some((provider) => provider.id === selectedProviderId && provider.enabled)) setSelectedProviderId(null);
      setNotice("Catalog selection saved");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setCatalogSaving(false);
    }
  }

  function toggleCatalogProvider(providerId: string): void {
    setCatalogSelection((current) => current.includes(providerId)
      ? current.filter((id) => id !== providerId)
      : [...current, providerId]);
  }

  function setCategorySelection(categoryId: string, selected: boolean): void {
    const ids = catalog.providers.filter((provider) => provider.categoryIds.includes(categoryId)).map((provider) => provider.id);
    setCatalogSelection((current) => selected
      ? [...new Set([...current, ...ids])]
      : current.filter((id) => !ids.includes(id)));
  }

  async function refreshDiagnostics(): Promise<void> {
    if (!diagnosticsApi) return;
    setDiagnosticsBusy(true);
    try {
      const [status, entries] = await Promise.all([
        diagnosticsApi.getStatus(),
        diagnosticsApi.getRecentLogs(200, logFilter)
      ]);
      setDiagnosticsStatus(status);
      setLoggingSettings(status.settings);
      setLogEntries(entries);
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setDiagnosticsBusy(false);
    }
  }

  async function saveLoggingSettings(): Promise<void> {
    if (!diagnosticsApi || diagnosticsBusy) return;
    setDiagnosticsBusy(true);
    try {
      const saved = await diagnosticsApi.updateSettings(loggingSettings);
      setLoggingSettings(saved);
      setDiagnosticsStatus(await diagnosticsApi.getStatus());
      setNotice("Logging settings saved");
      setError(null);
      setLogEntries(await diagnosticsApi.getRecentLogs(200, logFilter));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setDiagnosticsBusy(false);
    }
  }

  async function exportApplicationLogs(): Promise<void> {
    if (!diagnosticsApi || diagnosticsBusy) return;
    setDiagnosticsBusy(true);
    try {
      const destination = await diagnosticsApi.exportLogs();
      if (destination) setNotice("Logs exported to " + destination);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setDiagnosticsBusy(false);
    }
  }

  async function collectDiagnosticReport(): Promise<void> {
    if (!diagnosticsApi || diagnosticsBusy) return;
    setDiagnosticsBusy(true);
    try {
      const destination = await diagnosticsApi.collectReport();
      if (destination) setNotice("Diagnostic report saved to " + destination);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setDiagnosticsBusy(false);
    }
  }

  async function clearApplicationLogs(): Promise<void> {
    if (!diagnosticsApi || diagnosticsBusy || !window.confirm("Delete all current and rotated AIHub Studio log files?")) return;
    setDiagnosticsBusy(true);
    try {
      await diagnosticsApi.clearLogs();
      setLogEntries(await diagnosticsApi.getRecentLogs(200, logFilter));
      setDiagnosticsStatus(await diagnosticsApi.getStatus());
      setNotice("Log files cleared");
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setDiagnosticsBusy(false);
    }
  }

  async function openLogDirectory(): Promise<void> {
    if (!diagnosticsApi) return;
    try {
      const result = await diagnosticsApi.openLogDirectory();
      if (result) setError(result);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function saveProxySettings(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!browserApi || proxySaving) return;
    setProxySaving(true);
    setProxyNotice(null);
    setError(null);
    try {
      const normalized = await browserApi.setProxyServer(proxyServer);
      setProxyServer(normalized ?? "");
      setProxyNotice(normalized ? "Proxy applied to all Chromium profiles." : "System proxy settings restored.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setProxySaving(false);
    }
  }

  function closeBrowserTab(tabId: string): void {
    if (!browserApi) return;
    const wasActive = workspaceMode === "browser" && browserState.activeTabId === tabId;
    void runBrowserAction(async () => {
      const next = await browserApi.close(tabId);
      if (wasActive && !next.activeTabId) {
        const availableLocalIds = openLocalTabIds.filter((id) =>
          catalog.providers.some((provider) => provider.id === id && provider.type === "local-api")
        );
        if (availableLocalIds.length > 0) {
          setLocalChatProviderId(availableLocalIds.at(-1)!);
          setWorkspaceMode("local-chat");
        } else setWorkspaceMode("catalog");
      }
      return next;
    });
  }

  function activateWorkspaceTab(tab: WorkspaceTab): void {
    setError(null);
    if (tab.kind === "website") {
      if (!browserApi) return;
      setWorkspaceMode("browser");
      void runBrowserAction(() => browserApi.activate(tab.browserTabId));
      return;
    }
    setLocalChatProviderId(tab.providerId);
    setLocalChatDraft("");
    setWorkspaceMode("local-chat");
  }

  function closeLocalWorkspaceTab(providerId: string): void {
    const remaining = openLocalTabIds.filter((id) => id !== providerId);
    setOpenLocalTabIds(remaining);
    if (workspaceMode !== "local-chat" || localChatProviderId !== providerId) return;
    const availableLocalIds = remaining.filter((id) =>
      catalog.providers.some((provider) => provider.id === id && provider.type === "local-api")
    );
    if (availableLocalIds.length > 0) {
      setLocalChatProviderId(availableLocalIds.at(-1)!);
      setLocalChatDraft("");
    } else if (browserState.activeTabId && browserApi) {
      setWorkspaceMode("browser");
      void runBrowserAction(() => browserApi.activate(browserState.activeTabId!));
    } else setWorkspaceMode("catalog");
  }

  function closeWorkspaceTab(tab: WorkspaceTab): void {
    if (tab.kind === "website") closeBrowserTab(tab.browserTabId);
    else if (tab.kind === "local-ai") closeLocalWorkspaceTab(tab.providerId);
  }

  return (
    <div className="app-shell" onClick={() => menu && setMenu(null)}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <div className="brand-name">AIHub Studio</div>
            <div className="brand-edition">LINUX EDITION</div>
          </div>
        </div>

        <button className={workspaceMode === "settings" ? "nav-item nav-item-active sidebar-settings-button" : "nav-item sidebar-settings-button"} type="button" onClick={openSettings}>
          <span className="nav-icon">⚙</span><span>Настройки</span>
        </button>

        <div className="sidebar-scroll" aria-label="Workspace navigation">
        <div className="sidebar-label">WORKSPACE</div>
        <button className={workspaceMode === "catalog" && activeCategory === "all" ? "nav-item nav-item-active" : "nav-item"} type="button" onClick={() => { setWorkspaceMode("catalog"); setActiveCategory("all"); }}>
          <span className="nav-icon">▦</span><span>AI Catalog</span><span className="item-count">{catalog.providers.filter((item) => item.enabled).length}</span>
        </button>
        <button className={workspaceMode === "catalog" && activeCategory === "favorites" ? "nav-item nav-item-active" : "nav-item"} type="button" onClick={() => { setWorkspaceMode("catalog"); setActiveCategory("favorites"); }}>
          <span className="nav-icon favorite-icon">★</span><span>Favorites</span><span className="item-count">{catalog.providers.filter((item) => item.enabled && item.favorite).length}</span>
        </button>

        <div className="sidebar-divider" />
        <div className="category-heading">
          <div className="sidebar-label">CATEGORIES</div>
          <button className="icon-button" type="button" title="Add category" onClick={() => openModal({ kind: "category-add" })} onContextMenu={(event) => showContextMenu(event, { kind: "root" })}>＋</button>
        </div>
        <div className="category-list" aria-label="AI categories">
          {catalog.categories.map((category) => {
            const categoryProviders = catalog.providers.filter((provider) => provider.enabled && provider.categoryIds.includes(category.id));
            const expanded = expandedCategoryIds.includes(category.id);
            return (
              <div className="category-tree" key={category.id}>
                <div className={activeCategory === category.id ? "category-tree-row category-tree-row-active" : "category-tree-row"}
                  onContextMenu={(event) => showContextMenu(event, { kind: "category", id: category.id })}>
                  <button className="category-expand" type="button"
                    aria-label={(expanded ? "Collapse " : "Expand ") + category.name}
                    aria-expanded={expanded} disabled={categoryProviders.length === 0}
                    onClick={() => setExpandedCategoryIds((current) =>
                      toggleExpandedCategory(current, category.id)
                    )}>{expanded ? "▾" : "▸"}</button>
                  <button className={activeCategory === category.id ? "category-item category-item-active" : "category-item"}
                    type="button" onClick={() => { setWorkspaceMode("catalog"); setActiveCategory(category.id); }}
                    onContextMenu={(event) => showContextMenu(event, { kind: "category", id: category.id })}>
                    <span className="folder-icon">▰</span>
                    <span className="category-name">{category.name}</span>
                    <span className="item-count">{categoryProviders.length}</span>
                  </button>
                </div>
                {expanded && categoryProviders.length > 0 && (
                  <div className="category-children">
                    {categoryProviders.map((provider) => (
                      <button key={provider.id} className="category-provider" type="button"
                        title={provider.type === "website" ? provider.url : provider.name}
                        onClick={() => {
                          setSelectedProviderId(provider.id);
                          if (provider.type === "website") void openWebsite(provider);
                          else void openLocalChat(provider);
                        }}
                        onContextMenu={(event) => showContextMenu(event, { kind: "provider", id: provider.id })}>
                        {provider.type === "website"
                          ? <ProviderBrandIcon providerId={provider.id} name={provider.name} size="small" />
                          : <span className="category-provider-icon local-provider-icon">⌘</span>}
                        <span className="category-provider-name">{provider.name}</span>
                        {provider.favorite && <span className="category-provider-star">★</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        </div>

        <div className="sidebar-footer">
          <span>Chromium workspace · {window.aihub?.platform ?? "Linux"}</span>
          <span className="sidebar-version">{formatBuildLabel(__APP_VERSION__, __APP_BUILD__)}</span>
        </div>
      </aside>

      <main className="main-area">
        <header className="workspace-topbar">
          <div className="workspace-tabs" role="tablist" aria-label="Open AI workspaces">
            {workspaceTabs.map((tab) => {
              const active = activeWorkspaceTabKey === tab.key;
              return (
                <div key={tab.key} className={active ? "workspace-tab workspace-tab-active" : "workspace-tab"}>
                  <button className="workspace-tab-select" type="button" role="tab" aria-selected={active}
                    title={tab.kind === "website" ? tab.url : tab.title} onClick={() => activateWorkspaceTab(tab)}>
                    {tab.kind === "local-ai"
                      ? <span className="workspace-tab-icon local-tab-icon">⌘</span>
                      : <ProviderBrandIcon providerId={browserState.tabs.find((browserTab) => browserTab.id === tab.browserTabId)?.providerId ?? "website"} name={tab.title} size="small" />}
                    <span className="workspace-tab-label">{tab.title}</span>
                    {tab.kind === "website" && tab.loading && <span className="workspace-tab-loading">◌</span>}
                  </button>
                  <button className="workspace-tab-close" type="button"
                    title={"Close " + tab.title} aria-label={"Close " + tab.title}
                    onClick={() => closeWorkspaceTab(tab)}>×</button>
                </div>
              );
            })}
            {settingsOpen && (
              <div className={workspaceMode === "settings" ? "workspace-tab workspace-tab-active settings-workspace-tab" : "workspace-tab settings-workspace-tab"}>
                <button className="workspace-tab-select" type="button" role="tab" aria-selected={workspaceMode === "settings"}
                  onClick={() => {
                    if (workspaceMode !== "settings") settingsReturnMode.current = workspaceMode;
                    setWorkspaceMode("settings");
                  }}>
                  <span className="workspace-tab-icon settings-tab-icon">⚙</span>
                  <span className="workspace-tab-label">Настройки</span>
                </button>
                <button className="workspace-tab-close" type="button" title="Закрыть настройки" aria-label="Закрыть настройки"
                  onClick={closeSettings}>×</button>
              </div>
            )}
            <button className="workspace-new-tab" type="button" title="Add website or Local AI" aria-label="Add website or Local AI"
              onClick={(event) => { setWorkspaceMode("catalog"); setActiveCategory("all"); showContextMenu(event, { kind: "root" }); }}>＋</button>
          </div>
        </header>

        <section className={workspaceMode === "browser" || workspaceMode === "local-chat" ? "content-area content-area-full-workspace" : "content-area"}>
          {workspaceMode === "browser" ? (
            <div className="browser-workspace">
              <div className="browser-translation-toolbar">
                <button className={translationOpen ? "translation-toolbar-button translation-toolbar-button-active" : "translation-toolbar-button"}
                  type="button" onClick={() => setTranslationOpen((value) => !value)} disabled={!activeBrowserTab}>
                  <span className="translation-toolbar-icon">文</span>
                  <span>Перевод страницы</span><span className="translation-toolbar-language">Русский</span>
                  <span className="translation-toolbar-chevron">{translationOpen ? "⌃" : "⌄"}</span>
                </button>
                {translationOpen && (
                  <div className="translation-popover">
                    <div className="translation-popover-heading">
                      <span className="translation-popover-icon">文</span><strong>Перевод страницы</strong>
                      <span className="translation-local-badge">● Локально</span>
                    </div>
                    <div className="translation-language-row"><span>С оригинала</span><strong>{translationReport?.sourceLanguage ?? "Автоопределение по языку страницы"}</strong></div>
                    <div className="translation-language-row"><span>На язык</span><strong>Русский</strong></div>
                    <div className="translation-engine-row"><span>Движок</span><strong>Bergamot · WASM + SIMD</strong></div>
                    <div className="translation-privacy-note">Текст страницы не отправляется в облако. Модели загружаются один раз и хранятся локально.</div>
                    <label className="translation-auto-toggle">
                      <input type="checkbox" checked={translationAuto} onChange={(event) => {
                        setTranslationAuto(event.target.checked);
                      }} />
                      <span><strong>Автоматически переводить страницы</strong><small>Переводить после загрузки новых страниц</small></span>
                    </label>
                    <div className="translation-actions">
                      <button className="primary-button" type="button" disabled={translationBusy || !activeBrowserTab}
                        onClick={() => void translateActivePage()}>{translationBusy ? "Переводим…" : "Перевести страницу"}</button>
                      <button className="secondary-button" type="button" disabled={!translationReport}
                        onClick={() => void restoreOriginalPage()}>Показать оригинал</button>
                    </div>
                    <div className="translation-status" role="status">{translationBusy ? "Загрузка модели или перевод текста…" : translationNotice}</div>
                  </div>
                )}
              </div>
              {activeBrowserTab?.error && <div className="browser-error" role="alert">{activeBrowserTab.error}</div>}
              <div className="browser-viewport" ref={browserViewportRef}>
                {!activeBrowserTab && <div className="browser-empty">Open a cloud website from the AI catalog.</div>}
              </div>
            </div>
          ) : workspaceMode === "local-chat" ? (
            <div className="local-chat-workspace">
              <div className="local-chat-header">
                <div>
                  <div className="eyebrow">LOCAL AI · OPENAI-COMPATIBLE</div>
                  <h1>{activeLocalProvider?.name ?? "Local AI"}</h1>
                  <p>{activeLocalProvider ? "http://" + activeLocalProvider.host + ":" + activeLocalProvider.port : "Connection is no longer available"}</p>
                </div>
                <div className="local-chat-header-actions">
                  {activeLocalProvider && <button className="secondary-button" type="button" onClick={clearLocalChat}>Clear chat</button>}
                </div>
              </div>

              {activeLocalProvider && (
                <div className="local-model-bar">
                  <label>
                    <span>Model</span>
                    <select
                      value={activeLocalProvider.selectedModel ?? ""}
                      disabled={activeLocalProvider.models.length === 0}
                      onChange={(event) => void chooseLocalModel(activeLocalProvider.id, event.target.value)}
                    >
                      {activeLocalProvider.models.length === 0 && <option value="">No models discovered</option>}
                      {activeLocalProvider.models.map((model) => <option key={model} value={model}>{model}</option>)}
                    </select>
                  </label>
                  <button className="secondary-button" type="button" disabled={discoveringProviderId === activeLocalProvider.id} onClick={() => void refreshLocalModels(activeLocalProvider.id)}>
                    {discoveringProviderId === activeLocalProvider.id ? "Checking…" : "Refresh models"}
                  </button>
                </div>
              )}

              {error && <div className="alert alert-error" role="alert">{error}</div>}
              {notice && <div className="alert alert-success" role="status">{notice}</div>}

              <div className="local-chat-messages" aria-live="polite">
                {!activeLocalProvider && <div className="local-chat-empty">This Local AI connection was removed. Return to the catalog and select another connection.</div>}
                {activeLocalProvider && activeLocalMessages.length === 0 && (
                  <div className="local-chat-empty">
                    <div className="local-chat-empty-icon">⌘</div>
                    <h2>Start a local conversation</h2>
                    <p>Messages stay in this window session and are not written to a chat archive.</p>
                    {activeLocalProvider.models.length === 0 && <button className="primary-button" type="button" disabled={discoveringProviderId === activeLocalProvider.id} onClick={() => void refreshLocalModels(activeLocalProvider.id)}>Discover models</button>}
                  </div>
                )}
                {activeLocalMessages.map((message, index) => (
                  <article key={activeLocalProvider?.id + "-" + index} className={message.role === "user" ? "local-chat-message local-chat-user" : "local-chat-message local-chat-assistant"}>
                    <div className="local-chat-role">{message.role === "user" ? "YOU" : "LOCAL AI"}</div>
                    <div className="local-chat-content">{message.content}</div>
                  </article>
                ))}
                {localSending && <article className="local-chat-message local-chat-assistant"><div className="local-chat-role">LOCAL AI</div><div className="local-chat-content">Generating response…</div></article>}
              </div>

              <form className="local-chat-composer" onSubmit={sendLocalMessage}>
                <textarea
                  value={localChatDraft}
                  onChange={(event) => setLocalChatDraft(event.target.value)}
                  placeholder={activeLocalProvider?.selectedModel ? "Message your local model…" : "Discover and select a model first…"}
                  disabled={!activeLocalProvider?.selectedModel || localSending}
                  rows={3}
                />
                <div className="local-chat-composer-footer">
                  <span>Requests use the OpenAI-compatible /v1/chat/completions endpoint.</span>
                  <button className="primary-button" type="submit" disabled={!activeLocalProvider?.selectedModel || !localChatDraft.trim() || localSending}>
                    {localSending ? "Sending…" : "Send"}
                  </button>
                </div>
              </form>
            </div>
          ) : workspaceMode === "settings" ? (
            <div className="settings-page">
              <div className="page-heading">
                <div>
                  <div className="eyebrow">APPLICATION SETTINGS</div>
                  <h1>Settings</h1>
                  <p className="welcome-copy">Configure how Chromium connects to websites.</p>
                </div>
              </div>

              {error && <div className="alert alert-error" role="alert">{error}</div>}
              {notice && <div className="alert alert-success" role="status">{notice}</div>}
              {proxyNotice && <div className="alert alert-success" role="status">{proxyNotice}</div>}

              <section className="settings-card availability-settings-card" aria-label="AI service availability">
                <div className="settings-card-heading">
                  <div className="settings-card-icon">◉</div>
                  <div>
                    <h2>Проверка доступности AI</h2>
                    <p>Проверить весь каталог через текущую Chromium-сессию и настроенный прокси, включая региональные ограничения.</p>
                  </div>
                </div>
                <div className="availability-settings-toolbar">
                  <div className="availability-settings-region">
                    {availabilityReport ? (
                      <>
                        <strong>
                          Регион выхода: {availabilityReport.detectedCountryName
                            ? availabilityReport.detectedCountryName + " (" + availabilityReport.detectedCountryCode + ")"
                            : "не определён"}
                        </strong>
                        <small>Последняя проверка: {new Date(availabilityReport.checkedAt).toLocaleString()}</small>
                      </>
                    ) : (
                      <>
                        <strong>Проверка ещё не запускалась</strong>
                        <small>Проверка региона выполняется по публичному IP только после нажатия кнопки.</small>
                      </>
                    )}
                  </div>
                  <button className="primary-button availability-check-button" type="button"
                    disabled={availabilityBusy || !availabilityApi} onClick={() => void checkCatalogAvailability()}>
                    {availabilityBusy ? "Проверяем каталог…" : "Проверить все AI"}
                  </button>
                </div>
                {availabilitySummary && (
                  <div className="availability-summary availability-settings-summary">
                    <span className="availability-count-good">Доступно: {availabilitySummary.available}</span>
                    <span className="availability-count-warn">Защита / вход: {availabilitySummary.protected}</span>
                    <span className="availability-count-region">Регион: {availabilitySummary.restricted}</span>
                    <span className="availability-count-bad">Недоступно: {availabilitySummary.unavailable}</span>
                  </div>
                )}
                {availabilityReport ? (
                  <div className="availability-settings-results" aria-live="polite">
                    {availabilityReport.results.map((result) => {
                      const provider = catalog.providers.find((item) => item.id === result.providerId);
                      if (!provider) return null;
                      return (
                        <div className="availability-settings-result" key={result.providerId}>
                          <div className="availability-settings-provider">
                            {provider.type === "website"
                              ? <ProviderBrandIcon providerId={provider.id} name={provider.name} size="small" />
                              : <span className="catalog-local-icon">⌘</span>}
                            <span>
                              <strong>{provider.name}</strong>
                              <small>{provider.type === "website" ? provider.url : provider.apiType + " · " + provider.host + ":" + provider.port}</small>
                            </span>
                          </div>
                          <span className={"availability-badge availability-" + result.status} title={result.message}>
                            <span className="availability-dot" />{availabilityLabel(result.status)}
                            {result.latencyMs !== null ? " · " + result.latencyMs + " мс" : ""}
                          </span>
                          {result.regionNote && <small className="availability-settings-note" title={result.regionNote}>{result.regionNote}</small>}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="availability-settings-empty">
                    Нажми «Проверить все AI». Будет проверен каждый сервис, в том числе выключенный в левом каталоге.
                  </div>
                )}
                <div className="settings-help">
                  HTTP 401/403/429 означает возможную защиту или требование авторизации, а не гарантированную недоступность сервиса.
                </div>
              </section>

              <section className="settings-card catalog-sync-settings-card" aria-label="Catalog updates">
                <div className="settings-card-heading">
                  <div className="settings-card-icon">⟳</div>
                  <div>
                    <h2>Обновление каталога AI</h2>
                    <p>Получать актуальные веб-сервисы и OpenAI-совместимые API из двух публичных GitHub-списков. Встроенный пакет RU & CN Direct не удаляется.</p>
                  </div>
                </div>
                <div className="catalog-sync-toolbar">
                  <div>
                    <strong>{catalogSyncReport ? "Последняя синхронизация: " + new Date(catalogSyncReport.completedAt).toLocaleString() : "Источники GitHub подключены"}</strong>
                    <small>Обновление выполняется через Chromium session и настроенный прокси.</small>
                  </div>
                  <button className="primary-button" type="button" disabled={catalogSyncBusy || !catalogApi}
                    onClick={() => void syncCatalogNow()}>{catalogSyncBusy ? "Обновляем…" : "Обновить каталог"}</button>
                </div>
                <div className="catalog-sync-sources">
                  <div><strong>zebbern/no-cost-ai</strong><small>Веб-чаты, генераторы, голосовые сервисы и инструменты</small></div>
                  <div><strong>mnfst/awesome-free-llm-apis</strong><small>API-провайдеры, модели, контекст и опубликованные лимиты</small></div>
                  <div><strong>RU & CN Direct</strong><small>{catalog.providers.filter((provider) => provider.catalogSource === "builtin-ru-cn").length} встроенных сервисов · сохраняются при синхронизации</small></div>
                </div>
                {catalogSyncReport && (
                  <div className="catalog-sync-result" role="status">
                    <span>Добавлено: {catalogSyncReport.added}</span>
                    <span>Обновлено: {catalogSyncReport.updated}</span>
                    <span>Без изменений: {catalogSyncReport.unchanged}</span>
                    <span>Пропущено: {catalogSyncReport.skipped}</span>
                    {catalogSyncReport.sourceErrors.map((message) => <small className="catalog-sync-warning" key={message}>{message}</small>)}
                  </div>
                )}
                <div className="settings-help">Автосинхронизация выполняется при запуске приложения не чаще одного раза в сутки. Существующие избранные, включённые и пользовательские записи не заменяются.</div>
              </section>

              <section className="settings-card catalog-settings-card">
                <div className="settings-card-heading">
                  <div className="settings-card-icon">▦</div>
                  <div>
                    <h2>AI catalog</h2>
                    <p>Choose which services appear in the left sidebar. Unselected services remain available here.</p>
                  </div>
                </div>
                <div className="catalog-selection-toolbar">
                  <input aria-label="Search catalog" value={catalogSearch}
                    onChange={(event) => setCatalogSearch(event.target.value)} placeholder="Search all AI services…" />
                  <span>{catalogSelection.length} / {catalog.providers.length} selected</span>
                </div>
                <div className="catalog-selection-actions">
                  <button className="secondary-button" type="button"
                    onClick={() => setCatalogSelection([...new Set([...POPULAR_PROVIDER_IDS, ...catalog.providers.filter((provider) => provider.type === "local-api" && provider.enabled).map((provider) => provider.id)])])}>Popular set</button>
                  <button className="secondary-button" type="button" onClick={() => setCatalogSelection(catalog.providers.map((provider) => provider.id))}>Select all</button>
                  <button className="secondary-button" type="button" onClick={() => setCatalogSelection([])}>Clear selection</button>
                </div>
                <div className="catalog-category-list">
                  {catalog.categories.map((category) => {
                    const categoryProviders = catalog.providers.filter((provider) =>
                      provider.categoryIds.includes(category.id) &&
                      provider.name.toLocaleLowerCase().includes(catalogSearch.trim().toLocaleLowerCase())
                    );
                    if (categoryProviders.length === 0) return null;
                    const selectedCount = categoryProviders.filter((provider) => catalogSelection.includes(provider.id)).length;
                    return (
                      <details className="catalog-category" key={category.id} open={catalogSearch.trim().length > 0 || selectedCount > 0}>
                        <summary>
                          <span className="catalog-category-title">{category.name}</span>
                          <span className="catalog-category-count">{selectedCount} / {categoryProviders.length}</span>
                        </summary>
                        <div className="catalog-category-tools">
                          <button type="button" onClick={() => setCategorySelection(category.id, true)}>Select category</button>
                          <button type="button" onClick={() => setCategorySelection(category.id, false)}>Clear category</button>
                        </div>
                        <div className="catalog-provider-options">
                          {categoryProviders.map((provider) => (
                            <div className="catalog-provider-entry" key={provider.id}>
                            <label className="catalog-provider-option">
                              <input type="checkbox" checked={catalogSelection.includes(provider.id)}
                                onChange={() => toggleCatalogProvider(provider.id)} />
                              {provider.type === "website"
                                ? <ProviderBrandIcon providerId={provider.id} name={provider.name} size="small" />
                                : <span className="catalog-local-icon">⌘</span>}
                              <span>{provider.name}</span>
                              <small>{provider.type === "website" ? "Website" : "Local API"}</small>
                            </label>
                            {(provider.description || provider.limits || provider.apiBaseUrl || (provider.type === "website" && provider.modelDetails?.length)) && (
                              <details className="catalog-provider-info">
                                <summary>Описание и лимиты</summary>
                                {provider.description && <p>{provider.description}</p>}
                                {provider.limits && <p><strong>Лимиты:</strong> {provider.limits}</p>}
                                {provider.apiBaseUrl && <p><strong>API endpoint:</strong> <code>{provider.apiBaseUrl}</code></p>}
                                {provider.type === "website" && provider.modelDetails && provider.modelDetails.length > 0 && (
                                  <div className="catalog-model-details">
                                    {provider.modelDetails.map((model) => (
                                      <div className="catalog-model-detail" key={model.id}>
                                        <strong>{model.name}</strong>
                                        <small>{[model.context ? "Контекст " + model.context : "", model.maxOutput ? "Вывод " + model.maxOutput : "", model.modality ?? ""].filter(Boolean).join(" · ")}</small>
                                        {model.description && <small>{model.description}</small>}
                                        {model.limits && <small>Лимиты: {model.limits}</small>}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {provider.lastVerified && <small>Источник обновлён: {new Date(provider.lastVerified).toLocaleDateString()}</small>}
                              </details>
                            )}
                          </div>
                          ))}
                        </div>
                      </details>
                    );
                  })}
                </div>
                <div className="settings-actions">
                  <button className="primary-button" type="button" disabled={catalogSaving}
                    onClick={() => void saveCatalogSelection()}>{catalogSaving ? "Saving…" : "Apply selection"}</button>
                </div>
              </section>

              <form className="settings-card" onSubmit={saveProxySettings}>
                <div className="settings-card-heading">
                  <div className="settings-card-icon">⇄</div>
                  <div>
                    <h2>Browser proxy</h2>
                    <p>One proxy configuration shared by all Cloud Site browser profiles.</p>
                  </div>
                </div>

                <label className="form-field">
                  <span>Proxy server</span>
                  <input
                    value={proxyServer}
                    onChange={(event) => setProxyServer(event.target.value)}
                    placeholder="http://127.0.0.1:8080 or socks5://127.0.0.1:1080"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <div className="settings-help">
                  Supports HTTP, HTTPS, SOCKS4 and SOCKS5. Leave empty to use the system proxy settings.
                  Proxy credentials are not accepted in this field.
                </div>
                <div className="settings-actions">
                  <button className="secondary-button" type="button" disabled={proxySaving} onClick={() => setProxyServer("")}>Clear</button>
                  <button className="primary-button" type="submit" disabled={proxySaving}>{proxySaving ? "Applying…" : "Apply proxy"}</button>
                </div>
              </form>

              {diagnosticsStatus?.lastWriteError && (
                <div className="alert alert-error" role="alert">
                  Failed to write log files: {diagnosticsStatus.lastWriteError}
                </div>
              )}
              <section className="settings-card diagnostics-settings-card" aria-label="Diagnostics and logs">
                <div className="settings-card-heading">
                  <div className="settings-card-icon">▤</div>
                  <div>
                    <h2>Diagnostics and logs</h2>
                    <p>Logging levels, local log storage, automatic rotation and troubleshooting exports.</p>
                  </div>
                </div>

                <div className="diagnostics-settings-grid">
                  <label className="form-field">
                    <span>Logging level</span>
                    <select value={loggingSettings.level}
                      onChange={(event) => setLoggingSettings((current) => ({ ...current, level: event.target.value as LogLevel }))}>
                      <option value="debug">Debug — detailed troubleshooting</option>
                      <option value="info">Info — normal operation</option>
                      <option value="warn">Warning — warnings and errors</option>
                      <option value="error">Error — errors only</option>
                    </select>
                  </label>
                  <label className="diagnostics-toggle">
                    <input type="checkbox" checked={loggingSettings.fileEnabled}
                      onChange={(event) => setLoggingSettings((current) => ({ ...current, fileEnabled: event.target.checked }))} />
                    <span><strong>Write logs to files</strong><small>Store application logs on this device</small></span>
                  </label>
                  <label className="form-field">
                    <span>Maximum file size</span>
                    <select value={String(loggingSettings.maxFileSizeMb)}
                      onChange={(event) => setLoggingSettings((current) => ({ ...current, maxFileSizeMb: Number(event.target.value) }))}>
                      {[5, 10, 25, 50, 100].map((value) => <option key={value} value={value}>{value} MB</option>)}
                    </select>
                  </label>
                  <label className="form-field">
                    <span>Files to keep</span>
                    <select value={String(loggingSettings.maxFiles)}
                      onChange={(event) => setLoggingSettings((current) => ({ ...current, maxFiles: Number(event.target.value) }))}>
                      {[3, 5, 7, 10, 20, 30].map((value) => <option key={value} value={value}>{value} files (including current)</option>)}
                    </select>
                  </label>
                  <label className="form-field">
                    <span>Retention period</span>
                    <select value={String(loggingSettings.retentionDays)}
                      onChange={(event) => setLoggingSettings((current) => ({ ...current, retentionDays: Number(event.target.value) }))}>
                      {[1, 7, 14, 30, 60, 90].map((value) => <option key={value} value={value}>{value} days</option>)}
                    </select>
                  </label>
                </div>

                <div className="diagnostics-actions">
                  <button className="primary-button" type="button" disabled={diagnosticsBusy || !diagnosticsApi}
                    onClick={() => void saveLoggingSettings()}>{diagnosticsBusy ? "Working…" : "Save logging settings"}</button>
                  <button className="secondary-button" type="button" disabled={diagnosticsBusy}
                    onClick={() => void collectDiagnosticReport()}>Collect diagnostics</button>
                  <button className="secondary-button" type="button" disabled={diagnosticsBusy}
                    onClick={() => void exportApplicationLogs()}>Export logs</button>
                  <button className="danger-button" type="button" disabled={diagnosticsBusy}
                    onClick={() => void clearApplicationLogs()}>Clear logs</button>
                </div>

                <div className="diagnostics-path-row">
                  <div><strong>Log directory</strong><small>{diagnosticsStatus?.directory ?? "Loading log location…"}</small></div>
                  <button className="secondary-button" type="button" onClick={() => void openLogDirectory()}>Open folder</button>
                </div>

                <div className="diagnostics-log-heading">
                  <div><h3>Log viewer</h3><p>
                    {diagnosticsStatus
                      ? (diagnosticsStatus.currentFileBytes / 1024 / 1024).toFixed(2) + " MB current file · " + diagnosticsStatus.rotatedFiles + " rotated file(s)"
                      : "Log status unavailable"}
                  </p></div>
                  <div className="diagnostics-log-controls">
                    <select aria-label="Filter log level" value={logFilter} onChange={(event) => setLogFilter(event.target.value as LogLevel | "all")}>
                      <option value="all">All levels</option>
                      <option value="debug">Debug</option>
                      <option value="info">Info</option>
                      <option value="warn">Warning</option>
                      <option value="error">Error</option>
                    </select>
                    <button className="secondary-button" type="button" disabled={diagnosticsBusy}
                      onClick={() => void refreshDiagnostics()}>Refresh</button>
                  </div>
                </div>
                <div className="diagnostics-log-list" aria-live="polite">
                  {logEntries.length === 0 ? (
                    <div className="diagnostics-empty">No log entries for this filter. Try another level or refresh.</div>
                  ) : logEntries.map((entry, index) => (
                    <div className="diagnostics-log-entry" key={entry.timestamp + "-" + index}>
                      <time>{new Date(entry.timestamp).toLocaleString()}</time>
                      <span className={"log-level log-level-" + entry.level}>{entry.level.toUpperCase()}</span>
                      <span className="log-scope">{entry.scope}</span>
                      <span className="log-message">{entry.message}</span>
                    </div>
                  ))}
                </div>
                <div className="settings-help">
                  Authorization headers, API-key fields and common token query parameters are masked before file storage.
                  Log files use owner-only permissions. The default level is Info; switch to Debug temporarily when troubleshooting.
                </div>
              </section>

              <section className="settings-card version-card" aria-label="Application version">
                <div className="settings-card-heading">
                  <div className="settings-card-icon">ⓘ</div>
                  <div>
                    <h2>About AIHub Studio</h2>
                    <p>Version details to include when reporting a problem.</p>
                  </div>
                </div>
                <dl className="version-details">
                  <div>
                    <dt>Application version</dt>
                    <dd>v{__APP_VERSION__}</dd>
                  </div>
                  <div>
                    <dt>Build number</dt>
                    <dd>{__APP_BUILD__}</dd>
                  </div>
                  <div>
                    <dt>Platform</dt>
                    <dd>{window.aihub?.platform ?? "Linux"}</dd>
                  </div>
                </dl>
              </section>
            </div>
          ) : (
            <>
          <div className="page-heading">
            <div>
              <div className="eyebrow">AI WORKSPACE</div>
              <h1>{activeCategoryName}</h1>
              <p className="welcome-copy">Cloud websites and local AI endpoints in one catalog.</p>
            </div>
            <div className="page-count">{visibleProviders.length} CONNECTIONS</div>
          </div>

          {error && <div className="alert alert-error" role="alert">{error}</div>}
          {notice && <div className="alert alert-success" role="status">{notice}</div>}

          <section className="availability-toolbar" aria-label="AI service availability">
            <div className="availability-toolbar-copy">
              <strong><span className="availability-pulse" /> Проверка доступности AI</strong>
              <span>
                {availabilityReport
                  ? "Регион: " + (availabilityReport.detectedCountryName
                    ? availabilityReport.detectedCountryName + " (" + availabilityReport.detectedCountryCode + ")"
                    : "не определён") + " · " + new Date(availabilityReport.checkedAt).toLocaleString()
                  : "Проверь доступность сайтов и региональные ограничения для текущего подключения."}
              </span>
              {availabilityReport && availabilitySummary && (
                <div className="availability-summary">
                  <span className="availability-count-good">Доступно: {availabilitySummary.available}</span>
                  <span className="availability-count-warn">Защита: {availabilitySummary.protected}</span>
                  <span className="availability-count-region">Регион: {availabilitySummary.restricted}</span>
                  <span className="availability-count-bad">Недоступно: {availabilitySummary.unavailable}</span>
                </div>
              )}
              <small>Страна определяется по публичному IP через ipwho.is только после нажатия кнопки. HTTP 403/429 отмечается как защита, а не как подтверждённая поломка сайта.</small>
            </div>
            <button className="primary-button availability-check-button" type="button"
              disabled={availabilityBusy || !availabilityApi} onClick={() => void checkCatalogAvailability()}>
              {availabilityBusy ? "Проверяем…" : "Проверить сервисы"}
            </button>
          </section>

          <div className="connection-grid" aria-label="AI connections">
            {visibleProviders.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">＋</div>
                <h2>No connections here yet</h2>
                <p>Add a cloud website or a local OpenAI-compatible endpoint.</p>
                <div className="empty-actions">
                  <button className="secondary-button" type="button" onClick={() => openModal({ kind: "website-add" })}>Add website</button>
                  <button className="primary-button" type="button" onClick={() => openModal({ kind: "local-add" })}>Add Local AI</button>
                </div>
              </div>
            ) : visibleProviders.map((provider) => (
              <article key={provider.id}
                className={selectedProviderId === provider.id ? "connection-card connection-card-selected" : "connection-card"}
                onContextMenu={(event) => showContextMenu(event, { kind: "provider", id: provider.id })}>
                <button className="connection-open" type="button"
                  onClick={() => provider.type === "website" ? void openWebsite(provider) : void openLocalChat(provider)}
                  title={provider.type === "website" ? "Open website in a workspace tab" : "Open Local AI chat in a workspace tab"}>
                  {provider.type === "website"
                    ? <ProviderBrandIcon providerId={provider.id} name={provider.name} size="large" />
                    : <span className="provider-icon local-icon">⌘</span>}
                  <span className="connection-copy">
                    <span className="provider-name">{provider.name}</span>
                    <span className="provider-subtitle">{provider.type === "website" ? provider.url : provider.apiType + " · " + provider.host + ":" + provider.port}</span>
                  </span>
                  <span className={provider.type === "website" ? "type-pill cloud-pill" : "type-pill local-pill"}>{provider.type === "website" ? "CLOUD" : "LOCAL"}</span>
                </button>
                <div className="connection-card-footer">
                  <div className="connection-hint-stack">
                    {provider.type === "website" ? (() => {
                      const result = availabilityByProviderId.get(provider.id);
                      return result ? (
                        <>
                          <span className={"availability-badge availability-" + result.status} title={result.message}>
                            <span className="availability-dot" />{availabilityLabel(result.status)}
                            {result.latencyMs !== null ? " · " + result.latencyMs + " мс" : ""}
                          </span>
                          {result.regionNote && <small title={result.regionNote}>{result.regionNote}</small>}
                        </>
                      ) : <span className="connection-hint">Доступность не проверена</span>;
                    })() : <span className="connection-hint">{provider.models.length ? provider.models.length + " model(s) discovered" : "Open local chat"}</span>}
                  </div>
                  <div className="connection-actions">
                    {provider.favorite && <span className="provider-star" title="Favorite">★</span>}
                    <button className="connection-menu" type="button" title={"Manage " + provider.name}
                      aria-label={"Manage " + provider.name}
                      onClick={(event) => showContextMenu(event, { kind: "provider", id: provider.id })}>⋯</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
            </>
          )}
        </section>
      </main>

      {menu && (
        <div className="context-backdrop" onClick={() => setMenu(null)} onContextMenu={(event) => { event.preventDefault(); setMenu(null); }}>
          <div className="context-menu" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}>
            {menu.target.kind === "root" && <>
              <button type="button" onClick={() => invokeMenuAction("website-add")}>＋ Add Website</button>
              <button type="button" onClick={() => invokeMenuAction("local-add")}>＋ Add Local AI</button>
              <div className="context-divider" />
              <button type="button" onClick={() => invokeMenuAction("category-add")}>▰ Add Category</button>
            </>}
            {menu.target.kind === "category" && <>
              <button type="button" onClick={() => invokeMenuAction("website-add")}>＋ Add Website</button>
              <button type="button" onClick={() => invokeMenuAction("local-add")}>＋ Add Local AI</button>
              <div className="context-divider" />
              <button type="button" onClick={() => invokeMenuAction("category-edit")}>✎ Change</button>
              <button className="danger-menu-item" type="button" onClick={() => invokeMenuAction("category-delete")}>⌫ Del</button>
            </>}
            {menu.target.kind === "provider" && <>
              <button type="button" onClick={() => invokeMenuAction("provider-edit")}>✎ Change</button>
              <button type="button" onClick={() => invokeMenuAction("favorite")}>★ {contextProvider?.favorite ? "Remove from Favorites" : "Add to Favorites"}</button>
              <div className="context-divider" />
              <button className="danger-menu-item" type="button" onClick={() => invokeMenuAction("provider-delete")}>⌫ Del</button>
            </>}
          </div>
        </div>
      )}

      {modal && (
        <div className="modal-backdrop" onClick={() => !busy && setModal(null)}>
          <form className="modal-card" onSubmit={submitModal} onClick={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <div className="eyebrow">CATALOG MANAGEMENT</div>
                <h2>{modal.kind === "category-add" ? "Add category" :
                  modal.kind === "category-edit" ? "Change category" :
                  modal.kind === "website-add" ? "Add website" :
                  modal.kind === "local-add" ? "Add Local AI" : "Change connection"}</h2>
              </div>
              <button className="icon-button close-button" type="button" onClick={() => setModal(null)} aria-label="Close">×</button>
            </div>

            <label className="form-field">
              <span>{modal.kind.startsWith("category") ? "Category name" : "Name"}</span>
              <input autoFocus required value={formName} onChange={(event) => setFormName(event.target.value)} placeholder={modal.kind === "category-add" ? "New category" : "Connection name"} />
            </label>

            {(modal.kind === "website-add" || (modal.kind === "provider-edit" && modalProvider?.type === "website")) && (
              <label className="form-field">
                <span>Website URL</span>
                <input required type="text" value={formUrl} onChange={(event) => setFormUrl(event.target.value)} placeholder="https://example.com" />
              </label>
            )}

            {(modal.kind === "local-add" || (modal.kind === "provider-edit" && modalProvider?.type === "local-api")) && <>
              <label className="form-field">
                <span>API type</span>
                <input value="openai (OpenAI-compatible)" readOnly />
              </label>
              <div className="form-grid">
                <label className="form-field">
                  <span>Host</span>
                  <input required value={formHost} onChange={(event) => setFormHost(event.target.value)} placeholder="localhost" />
                </label>
                <label className="form-field">
                  <span>Port</span>
                  <input required inputMode="numeric" value={formPort} onChange={(event) => setFormPort(event.target.value)} placeholder="11434" />
                </label>
              </div>
              <div className="form-note">Models are discovered from the OpenAI-compatible API when you open this connection or refresh its model list.</div>
            </>}

            {(modal.kind === "website-add" || modal.kind === "local-add" || modal.kind === "provider-edit") && (
              <div className="form-field">
                <span>Categories</span>
                <div className="category-checklist">
                  {catalog.categories.map((category) => (
                    <label key={category.id} className="checkbox-row">
                      <input type="checkbox" checked={formCategoryIds.includes(category.id)} onChange={() => toggleCategory(category.id)} />
                      <span>{category.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button className="secondary-button" type="button" disabled={busy} onClick={() => setModal(null)}>Cancel</button>
              <button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default App;
