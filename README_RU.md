# AIHub Studio — Windows 10 x64

Ранняя desktop-оболочка для удалённой AI-инфраструктуры: AI-вкладки, Dockhand Web UI и базовый мониторинг CPU/RAM/NVIDIA с удалённым Linux ROCm-агентом для AMD MI50.

## Статус
Это прототип оболочки, а не полноценная IDE и не Windows-порт исходного Android/Kotlin AIHub v3.0.1. Редактор кода, интегрированный терминал, менеджер проектов и собственный Docker API-клиент ещё не реализованы.

## Windows-клиент
- Исходники: Python 3.11 x64, установить зависимости командой `pip install -r requirements.txt`, затем запустить `start_windows.bat`.
- MSI: откройте GitHub Actions → **Build Windows MSI** → **Run workflow**. Скачайте artifact `AIHubStudio-Windows10-x64-MSI`.
- Настройки хранятся в `%APPDATA%\AIHubStudio\settings.json`.

## Подключения
- Dockhand: https://dh.forsage.netcraze.link
- Open WebUI: https://ai.forsage.netcraze.link/
- Linux ROCm Agent: `http://SERVER_VPN_IP:8765` — замените на VPN/LAN адрес сервера.

## Архитектура
- Windows 10 x64 — клиентская оболочка.
- CachyOS/Linux — сервер моделей и AMD MI50 16 GB; ROCm-агент запускается именно там.
- Dockhand и Open WebUI открываются через существующие веб-интерфейсы.

## Безопасность
Не публикуйте Docker API и ROCm Agent напрямую в интернет. ROCm Agent должен быть доступен только по LAN/VPN и защищён длинным bearer-токеном. Используйте HTTPS для публичных веб-интерфейсов. Не коммитьте `settings.json`, токены или пароли.

## Linux ROCm agent

```bash
cd agent
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export GPU_AGENT_TOKEN='replace-with-a-long-random-secret'
uvicorn server:app --host 0.0.0.0 --port 8765
```

Перед запуском ограничьте доступ к порту 8765 интерфейсом VPN/локальной сетью firewall.

## Сборка MSI
Подробности: [BUILD_MSI_RU.md](BUILD_MSI_RU.md). Сборка выполняется на Windows runner GitHub Actions с PyInstaller и WiX Toolset.