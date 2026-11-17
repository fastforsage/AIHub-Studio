# Сборка MSI для Windows 10 x64

В репозитории настроен GitHub Actions workflow `.github/workflows/build-windows-msi.yml`.

1. Откройте вкладку **Actions**.
2. Выберите **Build Windows MSI**.
3. Нажмите **Run workflow**.
4. После завершения откройте запуск и скачайте artifact `AIHubStudio-Windows10-x64-MSI`.

Сборка выполняется на Windows Server 2022 runner: PyInstaller создаёт standalone-приложение, а **WiX Toolset 4.0.5** формирует x64 MSI. Версия WiX зафиксирована в workflow, поэтому он не устанавливает WiX v7 и не требует OSMF EULA.

Для релиза можно создать тег `v0.1.0`; workflow приложит MSI к GitHub Release.

Если сборка снова завершится ошибкой, откройте конкретный шаг в Actions и приложите полный лог, начиная с первой строки `error`.

Это ранний прототип: полноценный редактор кода, интегрированный терминал и собственный Docker API-клиент пока не реализованы. Перед публикацией для широкой аудитории нужны тесты на чистой Windows 10 и проверка ROCm-агента на конкретной версии ROCm.
