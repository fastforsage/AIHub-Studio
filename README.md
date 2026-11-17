# AIHub Studio

Windows 10 x64 desktop prototype for connecting to self-hosted AI services and a remote Linux GPU server.

## Status
Early prototype, not a full IDE yet. A source-code editor, integrated terminal, project manager, and native Docker API client are not implemented.

## Architecture
- Windows client: PySide6 desktop shell.
- Linux GPU host: FastAPI agent for AMD ROCm telemetry.
- Dockhand and Open WebUI: opened using their web interfaces.
- Server addresses are configured locally in the application; no private hostnames, IP addresses, or ports are published in this repository.

## Build
Use GitHub Actions → **Build Windows MSI** → **Run workflow**. Download the `AIHubStudio-Windows10-x64-MSI` artifact after the run completes.

## Configuration and privacy
Configure protocol, DNS names/IP addresses, and ports for Dockhand, Open WebUI, and the GPU agent in the application's **Settings** tab. The settings file is stored under `%APPDATA%\AIHubStudio\settings.json` on Windows.

Do not commit local settings, bearer tokens, passwords, private DNS names, or private IP addresses. Keep the GPU agent reachable only over a trusted LAN/VPN and do not expose the Docker API to the public Internet.

See [BUILD_MSI_RU.md](BUILD_MSI_RU.md) for build instructions.
