# AIHub Studio — Windows 10 x64

Ранняя desktop-оболочка для подключения к собственным AI-сервисам и удалённому Linux-серверу с GPU.

## Статус
Это прототип, а не полноценная IDE. Редактор исходного кода, встроенный терминал, менеджер проектов и собственный Docker API-клиент пока не реализованы.

## Архитектура
- Windows-клиент: desktop-приложение на PySide6.
- Linux-сервер с GPU: FastAPI-агент для телеметрии AMD ROCm.
- Dockhand и Open WebUI открываются через их веб-интерфейсы.
- Адреса серверов задаются локально в настройках приложения. Приватные DNS-имена, IP-адреса и порты в репозитории не публикуются.

## Запуск и сборка
- Для запуска из исходников нужен Python 3.11 x64: установите зависимости командой `pip install -r requirements.txt`, затем запустите `start_windows.bat`.
- Для MSI откройте GitHub Actions → **Build Windows MSI** → **Run workflow**. После завершения скачайте artifact `AIHubStudio-Windows10-x64-MSI`.
- Настройки Windows хранятся в `%APPDATA%\AIHubStudio\settings.json`.

## Настройка серверов
Во вкладке **Настройки** задаются протокол, DNS/IP и порт отдельно для:
- Dockhand;
- Open WebUI;
- GPU мониторинга (Linux ROCm Agent).

Для GPU Agent также задаётся Bearer Token. Не коммитьте локальный файл настроек, токены или пароли.

## Безопасность
GPU Agent должен быть доступен только по доверенной локальной сети или VPN. Не публикуйте его и Docker API напрямую в интернет.

## Linux ROCm Agent

```bash
cd agent
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export GPU_AGENT_TOKEN='replace-with-a-long-random-secret'
uvicorn server:app --host 0.0.0.0 --port 8765
```

Ограничьте доступ к порту агента правилами firewall.

## Сборка MSI
Подробности: [BUILD_MSI_RU.md](BUILD_MSI_RU.md). Сборка выполняется на Windows runner GitHub Actions с PyInstaller и WiX Toolset.
