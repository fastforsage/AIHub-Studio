function App() {
  const platform = window.aihub?.platform ?? "unknown";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <div className="brand-name">AIHub Studio</div>
            <div className="brand-edition">LINUX EDITION</div>
          </div>
        </div>
        <div className="sidebar-label">WORKSPACE</div>
        <button className="nav-item nav-item-active" type="button">
          <span className="nav-icon">▦</span><span>AI Catalog</span>
        </button>
        <button className="nav-item" type="button" disabled>
          <span className="nav-icon">☆</span><span>Favorites</span>
        </button>
        <div className="sidebar-divider" />
        <div className="sidebar-label">CATEGORIES</div>
        <div className="empty-categories">Categories will appear here</div>
        <div className="sidebar-spacer" />
        <button className="nav-item" type="button" disabled>
          <span className="nav-icon">⚙</span><span>Settings</span>
        </button>
        <div className="sidebar-footer">Chromium workspace · {platform}</div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <span className="muted">Workspace</span>
            <span className="breadcrumb-separator">/</span>
            <strong>AI Catalog</strong>
          </div>
          <div className="runtime-status"><span className="status-dot" />Desktop runtime ready</div>
        </header>

        <section className="welcome">
          <div className="eyebrow">LINUX EDITION · FOUNDATION</div>
          <h1>Your AI workspace.</h1>
          <p className="welcome-copy">One place for cloud AI websites and local language models.</p>

          <div className="foundation-grid">
            <article className="foundation-card">
              <div className="card-icon">◫</div>
              <div className="card-title">Chromium workspace</div>
              <div className="card-copy">A dedicated browser runtime is the foundation for cloud services.</div>
              <span className="card-state">Foundation stage</span>
            </article>
            <article className="foundation-card">
              <div className="card-icon">⌘</div>
              <div className="card-title">Local AI connections</div>
              <div className="card-copy">OpenAI-compatible local endpoints will live in the same catalog.</div>
              <span className="card-state">Planned for this release</span>
            </article>
            <article className="foundation-card">
              <div className="card-icon">▤</div>
              <div className="card-title">Categories and favorites</div>
              <div className="card-copy">Organize sites and model endpoints from the sidebar.</div>
              <span className="card-state">Next implementation stage</span>
            </article>
          </div>

          <div className="scope-note">
            <span className="scope-mark">i</span>
            Message capture and chat archiving are intentionally out of scope for the current development stages.
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
