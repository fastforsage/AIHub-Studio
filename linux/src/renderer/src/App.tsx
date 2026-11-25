import { FormEvent, MouseEvent, useEffect, useMemo, useState } from "react";
import type {
  AddLocalApiInput,
  AddWebsiteInput,
  CatalogState,
  Provider,
  ProviderUpdate
} from "../../catalog/catalogModel";

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
    { id: "ai", name: "AI" },
    { id: "local-ai", name: "Local AI" },
    { id: "dev", name: "Dev" },
    { id: "community", name: "Community" },
    { id: "design", name: "Design" },
    { id: "email", name: "Email" },
    { id: "video", name: "Video" }
  ],
  providers: []
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected application error";
}

function App() {
  const catalogApi = window.aihub?.catalog;
  const [catalog, setCatalog] = useState<CatalogState>(EMPTY_CATALOG);
  const [activeCategory, setActiveCategory] = useState("all");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [menu, setMenu] = useState<ContextMenuState>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formHost, setFormHost] = useState("localhost");
  const [formPort, setFormPort] = useState("11434");
  const [formCategoryIds, setFormCategoryIds] = useState<string[]>(["ai"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!catalogApi) {
      setError("The secure catalog bridge is unavailable. Restart the application.");
      return () => { cancelled = true; };
    }
    catalogApi.get().then((state) => {
      if (!cancelled) {
        setCatalog(state);
        setError(null);
      }
    }).catch((reason: unknown) => {
      if (!cancelled) setError(errorMessage(reason));
    });
    return () => { cancelled = true; };
  }, [catalogApi]);

  const selectedProvider = catalog.providers.find((provider) => provider.id === selectedProviderId) ?? null;
  const visibleProviders = useMemo(() => {
    if (activeCategory === "favorites") {
      return catalog.providers.filter((provider) => provider.favorite);
    }
    if (activeCategory === "all") return catalog.providers;
    return catalog.providers.filter((provider) => provider.categoryIds.includes(activeCategory));
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
      setCatalog(next);
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
      setFormCategoryIds([next.categoryId ?? "ai"]);
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

        <div className="sidebar-label">WORKSPACE</div>
        <button className={activeCategory === "all" ? "nav-item nav-item-active" : "nav-item"} type="button" onClick={() => setActiveCategory("all")}>
          <span className="nav-icon">▦</span><span>AI Catalog</span><span className="item-count">{catalog.providers.length}</span>
        </button>
        <button className={activeCategory === "favorites" ? "nav-item nav-item-active" : "nav-item"} type="button" onClick={() => setActiveCategory("favorites")}>
          <span className="nav-icon favorite-icon">★</span><span>Favorites</span><span className="item-count">{catalog.providers.filter((item) => item.favorite).length}</span>
        </button>

        <div className="sidebar-divider" />
        <div className="category-heading">
          <div className="sidebar-label">CATEGORIES</div>
          <button className="icon-button" type="button" title="Add category" onClick={() => openModal({ kind: "category-add" })} onContextMenu={(event) => showContextMenu(event, { kind: "root" })}>＋</button>
        </div>
        <div className="category-list">
          {catalog.categories.map((category) => (
            <button
              key={category.id}
              className={activeCategory === category.id ? "category-item category-item-active" : "category-item"}
              type="button"
              onClick={() => setActiveCategory(category.id)}
              onContextMenu={(event) => showContextMenu(event, { kind: "category", id: category.id })}
            >
              <span className="folder-icon">▰</span>
              <span className="category-name">{category.name}</span>
              <span className="item-count">{catalog.providers.filter((item) => item.categoryIds.includes(category.id)).length}</span>
            </button>
          ))}
        </div>

        <div className="sidebar-spacer" />
        <div className="sidebar-footer">Chromium workspace · {window.aihub?.platform ?? "Linux"}</div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span className="muted">Workspace</span><span className="breadcrumb-separator">/</span><strong>{activeCategoryName}</strong></div>
          <button className="primary-button top-add" type="button" onClick={(event) => showContextMenu(event, { kind: "root" })}>＋ Add</button>
        </header>

        <section className="content-area">
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

          <div className="catalog-layout">
            <section className="provider-list" aria-label="AI connections">
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
                <button
                  key={provider.id}
                  className={selectedProviderId === provider.id ? "provider-row provider-row-active" : "provider-row"}
                  type="button"
                  onClick={() => setSelectedProviderId(provider.id)}
                  onContextMenu={(event) => showContextMenu(event, { kind: "provider", id: provider.id })}
                >
                  <span className={provider.type === "website" ? "provider-icon website-icon" : "provider-icon local-icon"}>
                    {provider.type === "website" ? "◉" : "⌘"}
                  </span>
                  <span className="provider-main">
                    <span className="provider-name">{provider.name}</span>
                    <span className="provider-subtitle">{provider.type === "website" ? provider.url : provider.apiType + " · " + provider.host + ":" + provider.port}</span>
                  </span>
                  {provider.favorite && <span className="provider-star" aria-label="Favorite">★</span>}
                  <span className={provider.type === "website" ? "type-pill cloud-pill" : "type-pill local-pill"}>{provider.type === "website" ? "CLOUD" : "LOCAL"}</span>
                  <span className="row-menu" onClick={(event) => { event.stopPropagation(); showContextMenu(event, { kind: "provider", id: provider.id }); }}>⋯</span>
                </button>
              ))}
            </section>

            <aside className="details-panel">
              {selectedProvider ? (
                <>
                  <div className="details-type">{selectedProvider.type === "website" ? "CLOUD WEBSITE" : "LOCAL API CONNECTION"}</div>
                  <h2>{selectedProvider.name}</h2>
                  <div className="detail-line"><span>Type</span><strong>{selectedProvider.type === "website" ? "Chromium website" : "OpenAI-compatible API"}</strong></div>
                  {selectedProvider.type === "website" ? (
                    <div className="detail-line"><span>URL</span><strong>{selectedProvider.url}</strong></div>
                  ) : (
                    <>
                      <div className="detail-line"><span>Endpoint</span><strong>http://{selectedProvider.host}:{selectedProvider.port}</strong></div>
                      <div className="detail-line"><span>Models</span><strong>Auto-discovery planned</strong></div>
                    </>
                  )}
                  <div className="detail-line"><span>Categories</span><strong>{selectedProvider.categoryIds.map((id) => catalog.categories.find((item) => item.id === id)?.name).filter(Boolean).join(", ") || "All AI"}</strong></div>
                  <div className="detail-actions">
                    <button className="secondary-button" type="button" onClick={() => openModal({ kind: "provider-edit", id: selectedProvider.id })}>Change</button>
                    <button className="secondary-button" type="button" onClick={() => void commit(() => catalogApi!.setFavorite(selectedProvider.id, !selectedProvider.favorite))}>{selectedProvider.favorite ? "Unfavorite" : "Add to Favorites"}</button>
                  </div>
                  <p className="detail-hint">Browser tabs and live Local AI chat transport are added in their next implementation stages. This stage manages the connection catalog only.</p>
                </>
              ) : (
                <div className="detail-placeholder">
                  <div className="detail-placeholder-icon">⌘</div>
                  <h2>Select a connection</h2>
                  <p>Connection details and actions will appear here.</p>
                </div>
              )}
            </aside>
          </div>
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
              <button type="button" onClick={() => invokeMenuAction("favorite")}>★ {catalog.providers.find((item) => item.id === menu.target.id)?.favorite ? "Remove from Favorites" : "Add to Favorites"}</button>
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

            {(modal.kind === "website-add" || (modal.kind === "provider-edit" && selectedProvider?.type === "website")) && (
              <label className="form-field">
                <span>Website URL</span>
                <input required type="text" value={formUrl} onChange={(event) => setFormUrl(event.target.value)} placeholder="https://example.com" />
              </label>
            )}

            {(modal.kind === "local-add" || (modal.kind === "provider-edit" && selectedProvider?.type === "local-api")) && <>
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
              <div className="form-note">Models will be discovered automatically when Local AI API connectivity is implemented.</div>
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
