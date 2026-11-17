using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
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
    private readonly TextBox _address = new() { Dock = DockStyle.Fill, Text = "https://chatgpt.com" };
    private readonly Button _go = new() { Text = "Открыть", AutoSize = true };
    private readonly Label _status = new() { AutoSize = true, Text = "Инициализация WebView2…" };
    private readonly Label _count = new() { AutoSize = true, Text = "Сохранено сообщений: 0" };
    private readonly WebView2 _web = new() { Dock = DockStyle.Fill };
    private readonly string _dbPath;
    private readonly string _scriptPath;
    private int _savedCount;

    public CaptureForm()
    {
        Text = "AIHub — WebView2 Capture Prototype";
        Width = 1280;
        Height = 850;
        StartPosition = FormStartPosition.CenterScreen;

        var root = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 3, ColumnCount = 1 };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        var toolbar = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2, Padding = new Padding(8) };
        toolbar.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        toolbar.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        toolbar.Controls.Add(_address, 0, 0);
        toolbar.Controls.Add(_go, 1, 0);
        var info = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, Padding = new Padding(8, 2, 8, 6) };
        info.Controls.Add(_status);
        info.Controls.Add(new Label { Text = "   •   ", AutoSize = true });
        info.Controls.Add(_count);
        root.Controls.Add(toolbar, 0, 0);
        root.Controls.Add(info, 0, 1);
        root.Controls.Add(_web, 0, 2);
        Controls.Add(root);

        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var dataDir = Path.Combine(local, "AIHubStudio", "WebView2CapturePrototype");
        Directory.CreateDirectory(dataDir);
        _dbPath = Path.Combine(dataDir, "conversations.db");
        _scriptPath = Path.Combine(AppContext.BaseDirectory, "CaptureScript.js");

        _go.Click += (_, _) => Navigate();
        _address.KeyDown += (_, e) => { if (e.KeyCode == Keys.Enter) { Navigate(); e.SuppressKeyPress = true; } };
        Shown += async (_, _) => await InitializeBrowserAsync();
    }

    private async Task InitializeBrowserAsync()
    {
        try
        {
            var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var userData = Path.Combine(local, "AIHubStudio", "WebView2CapturePrototype", "BrowserData");
            Directory.CreateDirectory(userData);
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userData);
            await _web.EnsureCoreWebView2Async(environment);
            _web.CoreWebView2.Settings.AreDevToolsEnabled = true;
            _web.CoreWebView2.Settings.IsStatusBarEnabled = true;
            _web.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            _web.CoreWebView2.NavigationCompleted += async (_, _) => await InstallCaptureScriptAsync();
            await InstallCaptureScriptAsync();
            _status.Text = "WebView2 готов. Войдите на сайт и откройте диалог.";
            Navigate();
        }
        catch (Exception ex)
        {
            _status.Text = "Ошибка WebView2: " + ex.Message;
        }
    }

    private async Task InstallCaptureScriptAsync()
    {
        if (_web.CoreWebView2 is null || !File.Exists(_scriptPath)) return;
        var script = await File.ReadAllTextAsync(_scriptPath);
        await _web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(script);
        await _web.CoreWebView2.ExecuteScriptAsync(script);
    }

    private void Navigate()
    {
        if (_web.CoreWebView2 is null) return;
        var value = _address.Text.Trim();
        if (!value.StartsWith("https://", StringComparison.OrdinalIgnoreCase) &&
            !value.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
            value = "https://" + value;
        if (Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
            (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp))
            _web.CoreWebView2.Navigate(uri.ToString());
        else
            _status.Text = "Некорректный адрес.";
    }

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            var json = e.TryGetWebMessageAsString();
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (!root.TryGetProperty("type", out var type) || type.GetString() != "aihub-message") return;

            var url = root.GetProperty("url").GetString() ?? "";
            var provider = GetProvider(url);
            var conversationKey = GetConversationKey(url);
            var role = root.GetProperty("role").GetString() ?? "unknown";
            var content = root.GetProperty("text").GetString() ?? "";
            var messageKey = root.GetProperty("messageKey").GetString() ?? "";
            if (string.IsNullOrWhiteSpace(content) || string.IsNullOrWhiteSpace(messageKey)) return;

            await SaveMessageAsync(provider, conversationKey, messageKey, role, content, url);
            _savedCount++;
            _count.Text = $"Сохранено/обновлено событий: {_savedCount}";
            _status.Text = $"Захват: {provider} · {role} · {DateTime.Now:T}";
        }
        catch (Exception ex)
        {
            _status.Text = "Ошибка сохранения: " + ex.Message;
        }
    }

    private async Task SaveMessageAsync(string provider, string conversationKey, string messageKey, string role, string content, string url)
    {
        await using var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = _dbPath }.ToString());
        await db.OpenAsync();
        var create = db.CreateCommand();
        create.CommandText = """
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
        await create.ExecuteNonQueryAsync();

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
    }

    private static string GetProvider(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return "unknown";
        var host = uri.Host.ToLowerInvariant();
        if (host.Contains("chatgpt.com") || host.Contains("openai.com")) return "ChatGPT";
        if (host.Contains("claude.ai")) return "Claude";
        if (host.Contains("gemini.google.com")) return "Gemini";
        return host;
    }

    private static string GetConversationKey(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return url;
        var path = uri.AbsolutePath.Trim('/');
        return string.IsNullOrEmpty(path) ? uri.Host : uri.Host + "/" + path;
    }
}
