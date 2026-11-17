# AIHub Studio

Windows 10 x64 desktop prototype for connecting to self-hosted AI services and a remote Linux GPU server.

## Status
Early prototype, not a full IDE yet. A source-code editor, integrated terminal, project manager, and native Docker API client are not implemented.

## Architecture
- Windows client: PySide6 desktop shell with a single active Qt WebEngine chat surface, an Open WebUI-first assistant list, and persistent browser sessions.
- Linux GPU host: FastAPI agent for AMD ROCm telemetry; GPU metrics are polled only from this remote agent (no local `nvidia-smi` polling).
- Dockhand and Open WebUI: opened using their web interfaces.
- Server addresses are configured locally in the application; no private hostnames, IP addresses, or ports are published in this repository.

## Build
Use GitHub Actions → **Build Windows MSI** → **Run workflow**. Download the `AIHubStudio-Windows10-x64-MSI` artifact after the run completes.

## Configuration and privacy
Configure protocol, DNS names/IP addresses, and ports for Dockhand, Open WebUI, and the GPU agent in the application's **Settings** tab. The AI area uses one active Qt WebEngine view with Open WebUI pinned above the searchable cloud-assistant list; assistants can be reordered and marked as favorites. Browser cookies and site storage persist under `%APPDATA%\AIHubStudio\web-profile`. The settings file is stored under `%APPDATA%\AIHubStudio\settings.json`; sensitive GPU Agent and proxy values are encrypted locally with Windows DPAPI, without a Windows Credential Manager prompt. The in-app log viewer reads `%APPDATA%\AIHubStudio\AIHubStudio.log`.

Do not commit local settings, bearer tokens, passwords, private DNS names, or private IP addresses. Keep the GPU agent reachable only over a trusted LAN/VPN and do not expose the Docker API to the public Internet.

See [BUILD_MSI_RU.md](BUILD_MSI_RU.md) for build instructions.
