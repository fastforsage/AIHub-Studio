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
---

## Отказ от ответственности / Disclaimer

**Русский.** AIHub Studio — независимое стороннее приложение; оно не является официальным продуктом, представителем или партнёром перечисленных AI-провайдеров, если прямо не указано обратное. Все названия и товарные знаки принадлежат их правообладателям.

Пользователь самостоятельно отвечает за законность доступа к сайтам и API сторонних AI-провайдеров, а также за сбор, просмотр, копирование, хранение, экспорт, передачу и дальнейшую обработку любых полученных данных. Пользователь обязан соблюдать условия использования каждого провайдера и применимое законодательство, получить необходимые разрешения, согласия и иные правовые основания, а также не обходить технические ограничения, лимиты запросов и средства защиты. Пользователь несёт ответственность за безопасность своих учётных записей, cookies, токенов, локального профиля браузера и резервных копий.

Разработчики не контролируют сторонние сервисы, их доступность, ответы, политики, изменения интерфейсов, блокировки учётных записей или решения об ограничении доступа. Программа предоставляется «КАК ЕСТЬ» и «ПО МЕРЕ ДОСТУПНОСТИ», без гарантий бесперебойной работы или совместимости с конкретным провайдером. В максимально допустимой законом степени разработчики не отвечают за действия пользователя при работе со сторонними сервисами, нарушения пользователем правил провайдеров и неправомерный сбор или обработку данных пользователем. Ничто здесь не исключает ответственность или права, которые не могут быть ограничены законом. Этот текст не является юридической консультацией.

**English.** AIHub Studio is an independent third-party application. It is not an official product, representative, or partner of any listed AI provider unless expressly stated. All provider names and trademarks belong to their respective owners.

The user is solely responsible for ensuring that access to third-party AI provider websites and APIs, and the collection, viewing, copying, storage, export, disclosure, and further processing of any data obtained from them, are lawful. The user must comply with each provider's terms and applicable laws, obtain all required permissions, consents, and other lawful bases, and must not circumvent technical restrictions, rate limits, or security controls. The user is responsible for securing their accounts, cookies, tokens, local browser profile, and backups.

The developers do not control third-party services, their availability, responses, policies, interface changes, account suspensions, or access decisions. The software is provided **“AS IS” and “AS AVAILABLE”**, without warranties of uninterrupted operation or compatibility with any particular provider. To the maximum extent permitted by law, the developers disclaim liability for the user's conduct when using third-party services, the user's violations of provider terms, and unlawful data collection or processing by the user. Nothing in this notice excludes liability or rights that cannot legally be excluded or limited. This notice is not legal advice.
