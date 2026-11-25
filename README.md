# AIHub Studio

Cross-platform desktop workspace for cloud AI websites and local OpenAI-compatible models. The shared application is Electron + bundled Chromium + React + TypeScript.

> **Alpha 0.1.10:** This is an early test release. Expect bugs and provider-specific incompatibilities. See the [Russian documentation](docs/README.ru.md), [English documentation](docs/README.en.md), and [Alpha release notes](ALPHA-RELEASE-NOTES.md).

## Documentation

- [Документация на русском](docs/README.ru.md)
- [Documentation in English](docs/README.en.md)
- [Alpha release notes](ALPHA-RELEASE-NOTES.md)

## UI and functionality

- Persistent left AI catalog with expandable categories and Favorites.
- Add / Change / Del actions for categories and providers directly in the sidebar.
- Cloud AI websites open as tabs in one shared workspace, with persistent Chromium profile and cookies.
- Local AI connections use OpenAI-compatible `/v1/models` discovery and `/v1/chat/completions`.
- Configurable HTTP, HTTPS, SOCKS4 and SOCKS5 proxy.
- Settings and diagnostics/log viewer.
- Secure renderer isolation and validated IPC bridge.

## Windows 10/11 x64

The Windows build uses the same UI and Electron/Chromium runtime as Linux. App configuration is stored under `%APPDATA%\\AIHubStudio`; browser data under `%LOCALAPPDATA%\\AIHubStudio\\Data`; logs under `%LOCALAPPDATA%\\AIHubStudio\\Logs`.

GitHub Actions workflow **Build Windows MSI** runs unit tests, TypeScript checks, Electron build, Chromium smoke test, creates a Windows x64 unpacked application and packages it as an MSI with pinned WiX Toolset 5.0.2.

## Linux

The original Linux implementation and Arch/CachyOS packaging workflow remain in `linux/`. The root application can be packaged for Linux with `npm run package:linux`.

## Scope notes

The current alpha does not include automatic conversation capture/archive, SQLite chat history, attachment extraction/export, Dockhand integration or remote GPU telemetry.

## Disclaimer

AIHub Studio is an independent third-party client. Users are solely responsible for lawful access to AI provider services and for the collection, storage, export, disclosure, and processing of provider data. Users must comply with provider terms and applicable laws and obtain all required permissions and legal bases. The software is provided “AS IS”, to the maximum extent permitted by law. See the full notices in both language guides linked above.

## Development

Requires Node.js 24.22.x.

```bash
npm install
npm test
npm run typecheck
npm run build
npm run smoke
```
