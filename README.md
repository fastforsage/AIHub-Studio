# AIHub Studio

Windows 10 x64 desktop prototype for connecting to remote AI services and a Linux GPU server.

## Status
Early prototype. This is not yet a full IDE: code editor, integrated terminal, and production-grade Docker controls are not implemented.

## Architecture
- Windows client: PySide6 desktop shell.
- Remote Linux agent: FastAPI endpoint for AMD ROCm telemetry.
- Open WebUI and Dockhand: opened through their existing HTTPS web interfaces.

## Server layout
- Open WebUI: `https://ai.forsage.netcraze.link/`
- Dockhand: `https://dh.forsage.netcraze.link`
- GPU agent: bind to VPN/private interface only; do not expose Docker API or unauthenticated telemetry to the public Internet.

## Build
The Windows MSI is built by GitHub Actions on a Windows runner. See `.github/workflows/build-msi.yml`.

## Configuration
Copy `settings.example.json` to `settings.json` and set the private VPN URL for the GPU agent plus a strong bearer token. Do not commit secrets.

## License
Review the licenses of AIHub, Dockhand, and all bundled dependencies before redistribution.
