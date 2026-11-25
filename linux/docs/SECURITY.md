# Security baseline

## Renderer isolation
- contextIsolation must remain enabled.
- nodeIntegration must remain disabled for web content.
- sandbox and webSecurity remain enabled.
- Never expose raw ipcRenderer, require, filesystem, shell, or unrestricted network primitives through preload.
- Expose narrow, typed operations only.

## Browser content
- Remote websites are untrusted.
- Do not open arbitrary external protocols.
- Do not allow remote pages to navigate the application shell.
- Browser session permissions must be denied by default and granted explicitly per feature.
- Separate site profiles to avoid sharing cookies and local storage across providers.

## Local API configuration
- Local endpoints are editable.
- Credentials, when supported later, must not be written to logs.
- Connection errors must not include authorization headers or secret values.
- Do not silently assume that localhost:11434 uniquely identifies a specific runtime.

## Diagnostics
Message capture and raw network-body persistence are out of scope. The foundation must not inspect or store chat content.
