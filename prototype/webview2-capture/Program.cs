using System.Text.Json;
using System.Diagnostics;
using Microsoft.Data.Sqlite;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace AIHub.WebView2Capture;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new CaptureForm());
    }
}

internal sealed class CaptureForm : Form
{
    private static readonly System.Text.RegularExpressions.Regex UuidPattern = new(
        @"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b",
        System.Text.RegularExpressions.RegexOptions.Compiled | System.Text.RegularExpressions.RegexOptions.IgnoreCase);

    private static string RedactSensitive(string? value)
        => string.IsNullOrEmpty(value) ? (value ?? "") : UuidPattern.Replace(value, "{id}");

    private readonly TextBox _address = new() { Dock = DockStyle.Fill, Text = "https://chatgpt.com" };
    private readonly Button _go = new() { Text = "Открыть", AutoSize = true };
    private readonly Button _importAdapter = new() { Text = "Импорт адаптера JSON", AutoSize = true };
    private readonly Button _openLogs = new() { Text = "Открыть debug-логи", AutoSize = true };
    private readonly Button _collectDiagnostics = new() { Text = "Собрать диагностику", AutoSize = true };
    private readonly Label _status = new() { AutoSize = true, Text = "Инициализация WebView2…" };
    private readonly Label _count = new() { AutoSize = true, Text = "В БД: 0 сообщений" };
    private readonly TextBox _diagnostics = new()
    {
        Dock = DockStyle.Fill, Multiline = true, ReadOnly = true,
        ScrollBars = ScrollBars.Vertical, WordWrap = true, Height = 118,
        BackColor = System.Drawing.SystemColors.Info
    };
    private readonly WebView2 _web = new() { Dock = DockStyle.Fill };
    private readonly string _dbPath;
    private readonly AdapterRegistry _adapterRegistry;
    private readonly string _scriptPath;
    private readonly string _logDirectory;
    private readonly string _logPath;
    private int _receivedCount;
    private int _savedEvents;
    private int _scanCount;
    private int _domFound;
    private bool _captureScriptRegistered;
    private bool _adapterConfigRegistered;
    private string _lastDiagnostic = "Диагностика ещё не получена.";
    private string _domProbeDiagnostic = "DOM-probe ещё не получен.";

    public CaptureForm()
    {
        Text = "AIHub — WebView2 Capture Prototype";
        Width = 1280;
        Height = 900;
        StartPosition = FormStartPosition.CenterScreen;

        var root = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 4, ColumnCount = 1 };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 128));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        var toolbar = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 5, Padding = new Padding(8) };
        toolbar.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        toolbar.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        toolbar.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        toolbar.Controls.Add(_address, 0, 0);
        toolbar.Controls.Add(_go, 1, 0);
        toolbar.Controls.Add(_importAdapter, 2, 0);
        toolbar.Controls.Add(_openLogs, 3, 0);
        toolbar.Controls.Add(_collectDiagnostics, 4, 0);
        toolbar.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        var info = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, Padding = new Padding(8, 2, 8, 6) };
        info.Controls.Add(_status);
        info.Controls.Add(new Label { Text = "   •   ", AutoSize = true });
        info.Controls.Add(_count);
        root.Controls.Add(toolbar, 0, 0);
        root.Controls.Add(info, 0, 1);
        root.Controls.Add(_diagnostics, 0, 2);
        root.Controls.Add(_web, 0, 3);
        Controls.Add(root);

        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var dataDir = Path.Combine(local, "AIHubStudio", "WebView2CapturePrototype");
        Directory.CreateDirectory(dataDir);
        _dbPath = Path.Combine(dataDir, "conversations.db");
        _adapterRegistry = new AdapterRegistry(_dbPath);
        _scriptPath = Path.Combine(AppContext.BaseDirectory, "CaptureScript.js");
        _logDirectory = Path.Combine(dataDir, "Logs");
        Directory.CreateDirectory(_logDirectory);
        _logPath = Path.Combine(_logDirectory, $"capture-debug-{DateTime.Now:yyyyMMdd}.log");

        _go.Click += (_, _) => Navigate();
        _importAdapter.Click += async (_, _) => await ImportAdapterFromFileAsync();
        _openLogs.Click += (_, _) => OpenLogDirectory();
        _collectDiagnostics.Click += async (_, _) => await CollectDiagnosticsAsync();
        _address.KeyDown += (_, e) => { if (e.KeyCode == Keys.Enter) { Navigate(); e.SuppressKeyPress = true; } };
        Shown += async (_, _) => await InitializeBrowserAsync();
        WriteDebugLog("INFO", "app-start", $"Application started; logFile={_logPath}; scriptFile={_scriptPath}");
        UpdateDiagnostics("Приложение запущено. Ожидание WebView2.");
    }

    private void UpdateDiagnostics(string message)
    {
        WriteDebugLog("INFO", "app", message);
        _lastDiagnostic = RedactSensitive($"{DateTime.Now:HH:mm:ss}  {message}");
        _diagnostics.Text = RedactSensitive(
            $"Браузер: {(_web.CoreWebView2 is null ? "не готов" : "готов")} | Скрипт зарегистрирован: {_captureScriptRegistered}\r\n" +
            $"DOM: найдено {_domFound} | сканирований {_scanCount} | Получено событий: {_receivedCount} | Записей/обновлений SQLite: {_savedEvents}\r\n" +
            $"URL: {RedactConversationUrl(_web.Source?.ToString() ?? "(нет)")}\r\nЛог: {_logPath}\r\n{_domProbeDiagnostic}\r\n{_lastDiagnostic}");
    }

    private async Task InitializeBrowserAsync()
    {
        try
        {
            await _adapterRegistry.InitializeAsync();
            await InitializeDatabaseAsync();
            UpdateDiagnostics("Каталог адаптеров и схема сообщений подготовлены в SQLite. Создаю профиль WebView2…");
            var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var userData = Path.Combine(local, "AIHubStudio", "WebView2CapturePrototype", "BrowserData");
            Directory.CreateDirectory(userData);
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userData);
            await _web.EnsureCoreWebView2Async(environment);
            _web.CoreWebView2.Settings.AreDevToolsEnabled = true;
            _web.CoreWebView2.Settings.IsStatusBarEnabled = true;
            _web.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            _web.CoreWebView2.NavigationStarting += (_, e) =>
            {
                _status.Text = "Загрузка страницы…";
                UpdateDiagnostics($"Начата навигация: {e.Uri}");
            };
            _web.CoreWebView2.NavigationCompleted += async (_, e) =>
            {
                _status.Text = e.IsSuccess ? "Страница загружена. Войдите и откройте диалог." : $"Ошибка загрузки: {e.WebErrorStatus}";
                if (e.IsSuccess)
                {
                    var currentUrl = _web.Source?.ToString() ?? "";
                    var adapterId = _adapterRegistry.ResolveProvider(currentUrl);
                    await _adapterRegistry.RecordDetectionAsync(currentUrl, adapterId, adapterId == "unknown" ? 0.0 : 1.0);
                    UpdateDiagnostics($"Навигация завершена. Detector: {adapterId}.");
                }
                else
                {
                    UpdateDiagnostics($"Навигация завершилась ошибкой: {e.WebErrorStatus}");
                }
                await InstallCaptureScriptAsync();
                await RefreshDatabaseCountAsync();
            };
            await InstallCaptureScriptAsync();
            _status.Text = "WebView2 готов. Войдите на сайт и откройте диалог.";
            UpdateDiagnostics("WebView2 инициализирован. Перехожу на страницу.");
            Navigate();
        }
        catch (Exception ex)
        {
            _status.Text = "Ошибка WebView2: " + ex.Message;
            UpdateDiagnostics("ОШИБКА ИНИЦИАЛИЗАЦИИ: " + ex);
        }
    }

    private async Task InstallCaptureScriptAsync()
    {
        try
        {
            if (_web.CoreWebView2 is null)
            {
                UpdateDiagnostics("Нельзя внедрить скрипт: CoreWebView2 ещё не готов.");
                return;
            }
            if (!File.Exists(_scriptPath))
            {
                UpdateDiagnostics($"ФАЙЛ НЕ НАЙДЕН: {_scriptPath}");
                return;
            }
            var script = await File.ReadAllTextAsync(_scriptPath);
            var adapterConfig = _adapterRegistry.GetClientConfigJson();
            if (!_adapterConfigRegistered)
            {
                await _web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
                    $"window.__aihubAdapterCatalog = {adapterConfig};");
                _adapterConfigRegistered = true;
            }
            if (!_captureScriptRegistered)
            {
                await _web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(script);
                _captureScriptRegistered = true;
            }
            await _web.CoreWebView2.ExecuteScriptAsync(
                $"window.__aihubSetAdapterCatalog?.({adapterConfig});");
            // The document-created registration installs the script once per document.
            // Avoid executing it again after each navigation; the JS guard remains a safety net.
            UpdateDiagnostics($"CaptureScript зарегистрирован для документов ({new FileInfo(_scriptPath).Length} байт).");
        }
        catch (Exception ex)
        {
            UpdateDiagnostics("ОШИБКА ВНЕДРЕНИЯ СКРИПТА: " + ex);
        }
    }

    private async Task ApplyAdapterCatalogAsync()
    {
        if (_web.CoreWebView2 is null) return;
        var config = _adapterRegistry.GetClientConfigJson();
        await _web.CoreWebView2.ExecuteScriptAsync(
            $"window.__aihubSetAdapterCatalog?.({config});");
    }

    private async Task ImportAdapterFromFileAsync()
    {
        using var dialog = new OpenFileDialog
        {
            Filter = "JSON adapter (*.json)|*.json",
            Title = "Импорт JSON-адаптера"
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        try
        {
            var json = await File.ReadAllTextAsync(dialog.FileName);
            await _adapterRegistry.ImportAdapterAsync(json);
            await ApplyAdapterCatalogAsync();
            UpdateDiagnostics($"JSON-адаптер импортирован и сохранён в SQLite: {Path.GetFileName(dialog.FileName)}");
            MessageBox.Show(this, "Адаптер проверен и сохранён в каталоге SQLite.", "AIHub Studio",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception ex)
        {
            UpdateDiagnostics("ОШИБКА ИМПОРТА АДАПТЕРА: " + ex.Message);
            MessageBox.Show(this, ex.Message, "Не удалось импортировать адаптер",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void Navigate()
    {
        if (_web.CoreWebView2 is null)
        {
            UpdateDiagnostics("Навигация невозможна: WebView2 ещё не готов.");
            return;
        }
        var value = _address.Text.Trim();
        if (!value.StartsWith("https://", StringComparison.OrdinalIgnoreCase) &&
            !value.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
            value = "https://" + value;
        if (Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
            (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp))
            _web.CoreWebView2.Navigate(uri.ToString());
        else
        {
            _status.Text = "Некорректный адрес.";
            UpdateDiagnostics("Некорректный URL: " + value);
        }
    }

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            var json = e.TryGetWebMessageAsString();
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (!root.TryGetProperty("type", out var typeElement)) return;
            var type = typeElement.GetString();
            if (type == "aihub-diagnostic")
            {
                HandleScriptDiagnostic(root);
                return;
            }
            if (type != "aihub-message") return;

            _receivedCount++;
            var url = GetString(root, "url");
            var provider = _adapterRegistry.ResolveProvider(url);
            var confidence = provider == "unknown" ? 0.65 : 1.0;
            if (provider == "unknown") provider = "generic-chat";
            await _adapterRegistry.RecordDetectionAsync(url, provider, confidence);
            var conversationKey = GetConversationKey(url);
            var role = GetString(root, "role", "unknown");
            var content = GetString(root, "text");
            var messageKey = GetString(root, "messageKey");
            var previousMessageKey = GetString(root, "previousMessageKey");
            var strategy = GetString(root, "extractionStrategy", "unknown");
            WriteDebugLog("INFO", "message-received", $"provider={provider}; role={role}; strategy={strategy}; key={messageKey}; chars={content.Length}; url={url}");
            if (string.IsNullOrWhiteSpace(content) || string.IsNullOrWhiteSpace(messageKey))
            {
                UpdateDiagnostics($"Получено пустое сообщение (role={role}, key={messageKey.Length} символов).");
                return;
            }

            var saveStarted = System.Diagnostics.Stopwatch.StartNew();
            await SaveMessageAsync(provider, conversationKey, messageKey, previousMessageKey, role, content, url);
            saveStarted.Stop();
            WriteDebugLog("INFO", "sqlite-upsert", $"provider={provider}; role={role}; strategy={strategy}; key={messageKey}; chars={content.Length}; elapsedMs={saveStarted.ElapsedMilliseconds}");
            _savedEvents++;
            _count.Text = $"Записей/обновлений: {_savedEvents}";
            _status.Text = $"Захват: {provider} · {role}";
            UpdateDiagnostics($"SQLite OK: {provider}/{role}, {content.Length} символов. Последнее событие: {_receivedCount}.");
            await RefreshDatabaseCountAsync();
        }
        catch (Exception ex)
        {
            _status.Text = "Ошибка обработки сообщения: " + ex.Message;
            WriteDebugLog("ERROR", "message-handler-exception", ex.ToString());
            UpdateDiagnostics("ОШИБКА ПРИЁМА/СОХРАНЕНИЯ: " + ex);
        }
    }

    private void HandleScriptDiagnostic(JsonElement root)
    {
        var stage = GetString(root, "stage", "unknown");
        var detail = GetString(root, "detail");
        var url = GetString(root, "url");
        if (root.TryGetProperty("scanCount", out var scans) && scans.TryGetInt32(out var scanCount))
            _scanCount = scanCount;
        if (root.TryGetProperty("foundCount", out var found) && found.TryGetInt32(out var foundCount))
            _domFound = foundCount;

        if (stage == "dom-probe")
            _domProbeDiagnostic = $"JS [dom-probe]: {detail}";
        WriteDebugLog(stage == "post-error" || stage == "bridge-missing" ? "ERROR" : "DEBUG", "js-" + stage,
            $"detail={detail}; payload={root.ToString()}");
        var extra = stage == "script-start"
            ? $" | version={GetString(root, "scriptVersion", "unknown")}"
            : stage == "scan"
                ? $" | provider={GetString(root, "providerHost")} | adapter={GetString(root, "adapterId")} | confidence={GetString(root, "detectionConfidence")} | strategy={GetString(root, "strategy")} | найдено={_domFound} | scans={_scanCount}"
                : stage == "message-sent"
                    ? $" | role={GetString(root, "role")} | chars={GetInt(root, "textLength")}"
                    : stage == "api-capture"
                        ? $" | messagesSent={GetInt(root, "messagesSent")} | apiStatus={GetInt(root, "apiStatus")}"
                        : stage == "api-response"
                            ? $" | apiStatus={GetInt(root, "apiStatus")} | elapsedMs={GetInt(root, "elapsedMs")} | contentType={GetString(root, "contentType")} | bodyKind={GetString(root, "bodyKind")}"
                            : stage == "dom-candidate"
                                ? $" | role={GetString(root, "role")} | strategy={GetString(root, "strategy")} | chars={GetInt(root, "textLength")} | stableKey={GetString(root, "stableKeyPresent")}"
                                : "";
        UpdateDiagnostics($"JS [{stage}]: {detail}{extra} | {url}");
    }


    private void WriteDebugLog(string level, string category, string message)
    {
        try
        {
            var line = $"{DateTimeOffset.Now:O} [{level}] [{category}] {RedactSensitive(message)}{Environment.NewLine}";
            File.AppendAllText(_logPath, line);
        }
        catch
        {
            // Logging must never interrupt message capture or SQLite persistence.
        }
    }


    private async Task CollectDiagnosticsAsync()
    {
        _collectDiagnostics.Enabled = false;
        _collectDiagnostics.Text = "Сбор…";
        try
        {
            var timestamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
            var reportPath = Path.Combine(_logDirectory, $"diagnostic-report-{timestamp}.log");
            var scriptSnapshot = "{\"available\":false,\"reason\":\"WebView2 is not ready\"}";
            if (_web.CoreWebView2 is not null)
            {
                var raw = await _web.CoreWebView2.ExecuteScriptAsync(
                    "JSON.stringify(window.__aihubCollectDiagnostics?.() ?? { available: false, reason: 'diagnostic hook unavailable' })");
                try
                {
                    using var parsed = JsonDocument.Parse(raw);
                    scriptSnapshot = parsed.RootElement.ValueKind == JsonValueKind.String
                        ? parsed.RootElement.GetString() ?? "{}"
                        : parsed.RootElement.GetRawText();
                }
                catch { scriptSnapshot = raw; }
            }

            var report = new System.Text.StringBuilder();
            report.AppendLine("AIHub Studio — WebView2 capture diagnostic report");
            report.AppendLine($"Created: {DateTimeOffset.Now:O}");
            report.AppendLine($"App version: {Application.ProductVersion}");
            report.AppendLine($"OS: {Environment.OSVersion}");
            report.AppendLine($"Process: {Environment.ProcessPath}");
            report.AppendLine($"WebView2: {(_web.CoreWebView2 is null ? "not initialized" : _web.CoreWebView2.Environment.BrowserVersionString)}");
            report.AppendLine($"Capture script registered: {_captureScriptRegistered}");
            report.AppendLine($"Adapter config registered: {_adapterConfigRegistered}");
            report.AppendLine($"Received events: {_receivedCount}; SQLite upsert events: {_savedEvents}; DOM scans: {_scanCount}; last found count: {_domFound}");
            report.AppendLine($"Current URL: {RedactConversationUrl(_web.Source?.ToString() ?? "(none)")}");
            report.AppendLine($"Database path: {_dbPath}");
            report.AppendLine($"Debug log path: {_logPath}");
            report.AppendLine();
            report.AppendLine("=== WebView2 / DOM snapshot (message text intentionally excluded) ===");
            report.AppendLine(scriptSnapshot);
            report.AppendLine();
            report.AppendLine("=== Recent application debug log (last 250 lines) ===");
            if (File.Exists(_logPath))
            {
                var lines = await File.ReadAllLinesAsync(_logPath);
                foreach (var line in lines.TakeLast(250)) report.AppendLine(line);
            }
            else report.AppendLine("(debug log not found)");

            await File.WriteAllTextAsync(reportPath, RedactSensitive(report.ToString()), System.Text.Encoding.UTF8);
            WriteDebugLog("INFO", "diagnostic-report", $"Separate report created: {Path.GetFileName(reportPath)}");
            UpdateDiagnostics($"Диагностический отчёт сохранён: {reportPath}");
            MessageBox.Show(this, $"Отчёт собран. Текст переписки в снимок DOM не включается.\n\n{reportPath}",
                "Диагностика готова", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception ex)
        {
            WriteDebugLog("ERROR", "diagnostic-report-failed", ex.ToString());
            UpdateDiagnostics("Не удалось собрать диагностику: " + ex.Message);
            MessageBox.Show(this, ex.Message, "Ошибка сбора диагностики", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            _collectDiagnostics.Enabled = true;
            _collectDiagnostics.Text = "Собрать диагностику";
        }
    }

    private static string RedactConversationUrl(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)) return value;
        var path = uri.AbsolutePath;
        if (uri.Host.Equals("chatgpt.com", StringComparison.OrdinalIgnoreCase) &&
            System.Text.RegularExpressions.Regex.IsMatch(path, @"^/c/[^/]+"))
            path = "/c/{conversation-id}";
        return uri.GetLeftPart(UriPartial.Authority) + path;
    }

    private void OpenLogDirectory()
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = _logDirectory,
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            UpdateDiagnostics("Не удалось открыть папку логов: " + ex.Message);
        }
    }

    private async Task RefreshDatabaseCountAsync()
    {
        try
        {
            if (!File.Exists(_dbPath)) { _count.Text = "В БД: 0 сообщений"; return; }
            await using var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = _dbPath }.ToString());
            await db.OpenAsync();
            var command = db.CreateCommand();
            command.CommandText = "SELECT COUNT(*) FROM messages;";
            var count = Convert.ToInt64(await command.ExecuteScalarAsync());
            _count.Text = $"В БД: {count} сообщений";
        }
        catch (Exception ex)
        {
            UpdateDiagnostics("ОШИБКА ЧТЕНИЯ SQLITE: " + ex.Message);
        }
    }

    private static string GetString(JsonElement root, string name, string fallback = "")
        => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? fallback : fallback;

    private static int GetInt(JsonElement root, string name)
        => root.TryGetProperty(name, out var value) && value.TryGetInt32(out var number) ? number : 0;

    private async Task InitializeDatabaseAsync()
    {
        await using var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = _dbPath }.ToString());
        await db.OpenAsync();
        await using var command = db.CreateCommand();
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                provider TEXT NOT NULL,
                conversation_key TEXT NOT NULL,
                message_key TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                source_url TEXT NOT NULL,
                first_seen_utc TEXT NOT NULL,
                updated_utc TEXT NOT NULL,
                UNIQUE(provider, conversation_key, message_key)
            );
            CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(provider, conversation_key, id);
            """;
        await command.ExecuteNonQueryAsync();
    }

    private async Task SaveMessageAsync(string provider, string conversationKey, string messageKey, string previousMessageKey, string role, string content, string url)
    {
        await using var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = _dbPath }.ToString());
        await db.OpenAsync();

        if (!string.IsNullOrWhiteSpace(previousMessageKey) &&
            !string.Equals(previousMessageKey, messageKey, StringComparison.Ordinal))
        {
            var promote = db.CreateCommand();
            promote.CommandText = """
                UPDATE messages
                SET message_key=$newKey, updated_utc=$now
                WHERE provider=$provider AND conversation_key=$conversation AND message_key=$oldKey
                  AND NOT EXISTS (SELECT 1 FROM messages WHERE provider=$provider AND conversation_key=$conversation AND message_key=$newKey);
                DELETE FROM messages
                WHERE provider=$provider AND conversation_key=$conversation AND message_key=$oldKey
                  AND EXISTS (SELECT 1 FROM messages WHERE provider=$provider AND conversation_key=$conversation AND message_key=$newKey);
                """;
            promote.Parameters.AddWithValue("$newKey", messageKey);
            promote.Parameters.AddWithValue("$oldKey", previousMessageKey);
            promote.Parameters.AddWithValue("$provider", provider);
            promote.Parameters.AddWithValue("$conversation", conversationKey);
            promote.Parameters.AddWithValue("$now", DateTime.UtcNow.ToString("O"));
            await promote.ExecuteNonQueryAsync();
        }

        var command = db.CreateCommand();
        command.CommandText = """
            INSERT INTO messages(provider, conversation_key, message_key, role, content, source_url, first_seen_utc, updated_utc)
            VALUES($provider, $conversation, $key, $role, $content, $url, $now, $now)
            ON CONFLICT(provider, conversation_key, message_key)
            DO UPDATE SET content=excluded.content, source_url=excluded.source_url, updated_utc=excluded.updated_utc;
            """;
        var now = DateTime.UtcNow.ToString("O");
        command.Parameters.AddWithValue("$provider", provider);
        command.Parameters.AddWithValue("$conversation", conversationKey);
        command.Parameters.AddWithValue("$key", messageKey);
        command.Parameters.AddWithValue("$role", role);
        command.Parameters.AddWithValue("$content", content);
        command.Parameters.AddWithValue("$url", url);
        command.Parameters.AddWithValue("$now", now);
        await command.ExecuteNonQueryAsync();

        var stats = db.CreateCommand();
        stats.CommandText = """
            INSERT INTO adapter_extraction_stats(adapter_id, detections, extracted_messages, failures, updated_utc)
            VALUES($provider, 0, 1, 0, $now)
            ON CONFLICT(adapter_id) DO UPDATE SET
                extracted_messages=adapter_extraction_stats.extracted_messages+1,
                updated_utc=excluded.updated_utc;
            """;
        stats.Parameters.AddWithValue("$provider", provider);
        stats.Parameters.AddWithValue("$now", now);
        await stats.ExecuteNonQueryAsync();
    }

    private static string GetConversationKey(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return url;
        var path = uri.AbsolutePath.Trim('/');
        return string.IsNullOrEmpty(path) ? uri.Host : uri.Host + "/" + path;
    }
}
