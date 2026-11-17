using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace AIHub.WebView2Capture;

internal sealed record AdapterDefinition(
    string Id,
    string Name,
    string Vendor,
    int Version,
    bool Enabled,
    string[] Domains,
    double MinimumConfidence,
    string[] DomSignatures,
    string[] Strategies,
    string[] MessageSelectors,
    Dictionary<string, string> RoleMapping);

internal sealed class AdapterRegistry
{
    private static readonly HashSet<string> AllowedStrategies = new(StringComparer.OrdinalIgnoreCase)
    {
        "provider_dom", "semantic_dom"
    };

    private readonly string _connectionString;
    private readonly Dictionary<string, AdapterDefinition> _adapters = new(StringComparer.OrdinalIgnoreCase);

    public AdapterRegistry(string databasePath) =>
        _connectionString = new SqliteConnectionStringBuilder { DataSource = databasePath }.ToString();

    public async Task InitializeAsync()
    {
        await using var db = new SqliteConnection(_connectionString);
        await db.OpenAsync();
        var schema = db.CreateCommand();
        schema.CommandText = """
            CREATE TABLE IF NOT EXISTS adapter_definitions (
                adapter_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                version INTEGER NOT NULL,
                enabled INTEGER NOT NULL,
                definition_json TEXT NOT NULL,
                updated_utc TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS adapter_versions (
                adapter_id TEXT NOT NULL,
                version INTEGER NOT NULL,
                definition_json TEXT NOT NULL,
                imported_utc TEXT NOT NULL,
                PRIMARY KEY(adapter_id, version)
            );
            CREATE TABLE IF NOT EXISTS adapter_detection_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                host TEXT NOT NULL,
                adapter_id TEXT,
                confidence REAL NOT NULL,
                detected_utc TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS adapter_extraction_stats (
                adapter_id TEXT PRIMARY KEY,
                detections INTEGER NOT NULL DEFAULT 0,
                extracted_messages INTEGER NOT NULL DEFAULT 0,
                failures INTEGER NOT NULL DEFAULT 0,
                updated_utc TEXT NOT NULL
            );
            """;
        await schema.ExecuteNonQueryAsync();

        var catalogPath = Path.Combine(AppContext.BaseDirectory, "adapters", "catalog.json");
        if (File.Exists(catalogPath))
        {
            using var catalog = JsonDocument.Parse(await File.ReadAllTextAsync(catalogPath));
            if (catalog.RootElement.ValueKind != JsonValueKind.Array)
                throw new InvalidDataException("The bundled adapter catalog must be a JSON array.");
            foreach (var item in catalog.RootElement.EnumerateArray())
                await ImportIfMissingAsync(db, item.GetRawText());
        }

        await LoadEnabledAsync(db);
    }

    public async Task ImportAdapterAsync(string json)
    {
        var adapter = ParseAndValidate(json);
        await using var db = new SqliteConnection(_connectionString);
        await db.OpenAsync();
        var now = DateTime.UtcNow.ToString("O");
        var command = db.CreateCommand();
        command.CommandText = """
            INSERT INTO adapter_definitions(adapter_id,name,version,enabled,definition_json,updated_utc)
            VALUES($id,$name,$version,$enabled,$json,$now)
            ON CONFLICT(adapter_id) DO UPDATE SET
                name=excluded.name, version=excluded.version, enabled=excluded.enabled,
                definition_json=excluded.definition_json, updated_utc=excluded.updated_utc
            WHERE excluded.version > adapter_definitions.version;
            INSERT OR IGNORE INTO adapter_versions(adapter_id,version,definition_json,imported_utc)
            VALUES($id,$version,$json,$now);
            """;
        command.Parameters.AddWithValue("$id", adapter.Id);
        command.Parameters.AddWithValue("$name", adapter.Name);
        command.Parameters.AddWithValue("$version", adapter.Version);
        command.Parameters.AddWithValue("$enabled", adapter.Enabled ? 1 : 0);
        command.Parameters.AddWithValue("$json", json);
        command.Parameters.AddWithValue("$now", now);
        await command.ExecuteNonQueryAsync();
        await ReloadAsync(db);
    }

    private async Task ReloadAsync(SqliteConnection? existing = null)
    {
        _adapters.Clear();
        if (existing is null)
        {
            await using var db = new SqliteConnection(_connectionString);
            await db.OpenAsync();
            await LoadEnabledAsync(db);
            return;
        }
        await LoadEnabledAsync(existing);
    }

    private async Task LoadEnabledAsync(SqliteConnection db)
    {
        var read = db.CreateCommand();
        read.CommandText = "SELECT definition_json FROM adapter_definitions WHERE enabled=1;";
        await using var reader = await read.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            try
            {
                var adapter = ParseAndValidate(reader.GetString(0));
                _adapters[adapter.Id] = adapter;
            }
            catch (JsonException) { }
            catch (InvalidDataException) { }
        }
    }

    public string GetClientConfigJson()
    {
        var payload = _adapters.Values.Select(adapter => new
        {
            id = adapter.Id,
            domains = adapter.Domains,
            domSignatures = adapter.DomSignatures,
            strategies = adapter.Strategies,
            messageSelectors = adapter.MessageSelectors,
            roleMapping = adapter.RoleMapping,
            minimumConfidence = adapter.MinimumConfidence
        });
        return JsonSerializer.Serialize(payload);
    }

    public string ResolveProvider(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return "unknown";
        var host = uri.Host.ToLowerInvariant();
        var match = _adapters.Values
            .Where(a => a.Domains.Any(domain => host == domain || host.EndsWith("." + domain, StringComparison.OrdinalIgnoreCase)))
            .OrderByDescending(a => a.Domains.Max(d => d.Length))
            .FirstOrDefault();
        return match?.Id ?? "unknown";
    }

    public async Task RecordDetectionAsync(string url, string adapterId, double confidence)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return;
        await using var db = new SqliteConnection(_connectionString);
        await db.OpenAsync();
        var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO adapter_detection_logs(host, adapter_id, confidence, detected_utc)
            VALUES($host, $adapter, $confidence, $now);
            """;
        cmd.Parameters.AddWithValue("$host", uri.Host);
        cmd.Parameters.AddWithValue("$adapter", adapterId);
        cmd.Parameters.AddWithValue("$confidence", Math.Clamp(confidence, 0, 1));
        cmd.Parameters.AddWithValue("$now", DateTime.UtcNow.ToString("O"));
        await cmd.ExecuteNonQueryAsync();
    }

    private async Task ImportIfMissingAsync(SqliteConnection db, string json)
    {
        var adapter = ParseAndValidate(json);
        var exists = db.CreateCommand();
        exists.CommandText = "SELECT 1 FROM adapter_definitions WHERE adapter_id=$id;";
        exists.Parameters.AddWithValue("$id", adapter.Id);
        if (await exists.ExecuteScalarAsync() is not null) return;

        var now = DateTime.UtcNow.ToString("O");
        var insert = db.CreateCommand();
        insert.CommandText = """
            INSERT INTO adapter_definitions(adapter_id,name,version,enabled,definition_json,updated_utc)
            VALUES($id,$name,$version,$enabled,$json,$now);
            INSERT INTO adapter_versions(adapter_id,version,definition_json,imported_utc)
            VALUES($id,$version,$json,$now);
            """;
        insert.Parameters.AddWithValue("$id", adapter.Id);
        insert.Parameters.AddWithValue("$name", adapter.Name);
        insert.Parameters.AddWithValue("$version", adapter.Version);
        insert.Parameters.AddWithValue("$enabled", adapter.Enabled ? 1 : 0);
        insert.Parameters.AddWithValue("$json", json);
        insert.Parameters.AddWithValue("$now", now);
        await insert.ExecuteNonQueryAsync();
    }

    private static AdapterDefinition ParseAndValidate(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        string RequiredString(string key)
        {
            if (!root.TryGetProperty(key, out var value) || value.ValueKind != JsonValueKind.String ||
                string.IsNullOrWhiteSpace(value.GetString()))
                throw new InvalidDataException($"Adapter field '{key}' is required.");
            return value.GetString()!;
        }
        string[] StringArray(string key)
        {
            if (!root.TryGetProperty(key, out var value) || value.ValueKind != JsonValueKind.Array)
                return [];
            return value.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String)
                .Select(x => x.GetString()!).Where(x => !string.IsNullOrWhiteSpace(x)).ToArray();
        }

        var id = RequiredString("id");
        if (!Regex.IsMatch(id, "^[a-z0-9][a-z0-9_-]{1,63}$"))
            throw new InvalidDataException("Adapter id contains unsupported characters.");
        var version = root.TryGetProperty("version", out var v) && v.TryGetInt32(out var n) ? n : 0;
        if (version < 1) throw new InvalidDataException("Adapter version must be positive.");
        if (!root.TryGetProperty("detection", out var detection) || detection.ValueKind != JsonValueKind.Object)
            throw new InvalidDataException("Adapter detection object is required.");
        if (!root.TryGetProperty("extraction", out var extraction) || extraction.ValueKind != JsonValueKind.Object)
            throw new InvalidDataException("Adapter extraction object is required.");
        var confidence = detection.TryGetProperty("minimum_confidence", out var confidenceElement) &&
            confidenceElement.TryGetDouble(out var score) ? score : 0.7;
        if (confidence is < 0 or > 1) throw new InvalidDataException("minimum_confidence must be between 0 and 1.");
        var domains = StringArray("domains");
        if (domains.Length == 0 || domains.Any(domain => Uri.CheckHostName(domain) != UriHostNameType.Dns))
            throw new InvalidDataException("At least one valid DNS domain is required.");
        var mapping = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (extraction.TryGetProperty("role_mapping", out var roles) && roles.ValueKind == JsonValueKind.Object)
            foreach (var item in roles.EnumerateObject())
                if (item.Value.ValueKind == JsonValueKind.String) mapping[item.Name] = item.Value.GetString()!;

        var strategies = StringArrayFrom(root, "extraction", "strategies");
        if (strategies.Length == 0 || strategies.Any(s => !AllowedStrategies.Contains(s)))
            throw new InvalidDataException("Adapter must request one or more supported extraction strategies.");

        return new AdapterDefinition(id, RequiredString("name"),
            root.TryGetProperty("vendor", out var vendor) ? vendor.GetString() ?? "unknown" : "unknown",
            version, !root.TryGetProperty("enabled", out var enabled) || enabled.ValueKind != JsonValueKind.False,
            domains, confidence, StringArrayFrom(root, "detection", "dom_signatures"),
            strategies, StringArrayFrom(root, "extraction", "message_selectors"), mapping);
    }

    private static string[] StringArrayFrom(JsonElement root, string parent, string key) =>
        root.TryGetProperty(parent, out var p) && p.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.Array
            ? value.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).ToArray()
            : [];
}

