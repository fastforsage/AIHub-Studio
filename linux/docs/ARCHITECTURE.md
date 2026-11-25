# AIHub Studio Linux — архитектура

## Принцип разделения
Приложение делится на Electron Main, Preload, React Renderer, Browser Manager, Local AI Manager и Configuration Manager. Веб-контент не получает Node.js API.

## Компоненты

### Electron Main
Жизненный цикл приложения, окна, файловые пути XDG, управление сессиями, безопасные IPC-операции.

### Preload
Минимальный bridge через contextBridge. Экспортирует только явно разрешённые методы. Не предоставляет произвольные файловые, shell или Node.js API.

### React Renderer
Sidebar, категории, каталог, формы Add / Change / Del, вкладки, рабочая область и настройки.

### Browser Manager
Chromium-вкладки через WebContentsView, изолированные persistent session partitions, навигация и cookies/site storage. Каждый Cloud Site получает собственный профиль; вкладки одного provider используют один профиль.

Глобальный proxy хранится отдельно в browser-settings.json и применяется ко всем существующим и новым профилям. Пустое значение включает системный proxy mode. Поддерживаются HTTP, HTTPS, SOCKS4 и SOCKS5 без встроенных credentials.

### Local AI Manager
OpenAI-compatible HTTP client, проверка endpoint, обнаружение моделей, выбор модели и отправка запросов.

### Configuration Manager
Постоянные настройки категорий и подключений. Отдельно от будущего архива сообщений.

## Модель каталога
Общий базовый Provider:
- id;
- name;
- type: website или local-api;
- categoryIds;
- favorite;
- enabled.

Website Provider содержит URL и profileId.

Local API Provider содержит API type, host, port, обнаруженные модели и выбранную модель.

## Данные и XDG
- Конфигурация: XDG_CONFIG_HOME/AIHubStudio (по умолчанию ~/.config/AIHubStudio).
- Данные/профили: XDG_DATA_HOME/AIHubStudio (по умолчанию ~/.local/share/AIHubStudio).
- Состояние и журналы: XDG_STATE_HOME/AIHubStudio (по умолчанию ~/.local/state/AIHubStudio).

## Безопасность
- contextIsolation: true.
- nodeIntegration: false.
- sandbox: true.
- webSecurity: true.
- Только разрешённый preload bridge.
- IPC валидируется в Main.
- Не хранить секреты в логах.
- Внешний веб-контент не считается доверенным.

## Отложенные подсистемы
Capture Engine, извлечение сообщений, нормализация, архив переписок, дедупликация, Dockhand и GPU мониторинг не входят в текущую реализацию. Текущие компоненты не должны требовать их наличия.
