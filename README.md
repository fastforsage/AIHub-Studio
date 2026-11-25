# AIHub Studio

Cross-platform desktop workspace for cloud AI websites and local OpenAI-compatible models. The shared application is Electron + bundled Chromium + React + TypeScript.

## UI and functionality

- Persistent left AI catalog with expandable categories and Favorites.
- Add / Change / Del actions for categories and providers directly in the sidebar.
- Cloud AI websites open as tabs in one shared workspace, with persistent Chromium profile and cookies.
- Local AI connections use OpenAI-compatible `/v1/models` discovery and `/v1/chat/completions`.
- Configurable HTTP, HTTPS, SOCKS4 and SOCKS5 proxy.
- Settings and diagnostics/log viewer.
- Secure renderer isolation and validated IPC bridge.

## Windows 10 x64

The Windows build uses the same UI and Electron/Chromium runtime as Linux. App configuration is stored under `%APPDATA%\\AIHubStudio`; browser data under `%LOCALAPPDATA%\\AIHubStudio\\Data`; logs under `%LOCALAPPDATA%\\AIHubStudio\\Logs`.

GitHub Actions workflow **Build Windows MSI** runs unit tests, TypeScript checks, Electron build, Chromium smoke test, creates a Windows x64 unpacked application and packages it as an MSI with pinned WiX Toolset 5.0.2.

## Development

Requires Node.js 24.22.x.

```powershell
npm install
npm run dev
npm test
npm run typecheck
npm run build
npm run smoke
npm run package:win
```

## Linux

The original Linux implementation and Arch/CachyOS packaging workflow remain in `linux/`. The root application shares its Electron/React source and can be packaged for Linux with `npm run package:linux`.

## Scope notes

The current Linux-derived MVP does not yet include conversation capture/archive, SQLite history, attachment extraction/export, Dockhand integration or remote GPU telemetry. Those are separate follow-up subsystems, not silently claimed as implemented.
