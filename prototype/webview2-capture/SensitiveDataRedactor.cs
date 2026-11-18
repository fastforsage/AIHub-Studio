using System.Text.RegularExpressions;

namespace AIHub.WebView2Capture;

public static class SensitiveDataRedactor
{
    private static readonly Regex JwtPattern = new(
        @"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex SecretParamPattern = new(
        @"(?i)(?<=[?&#])(access_token|id_token|refresh_token|code|state|nonce|code_challenge|signature|sig|token|api_key)=([^&\s""'#]+)",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex UuidPattern = new(
        @"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public static string Redact(string? value)
    {
        if (string.IsNullOrEmpty(value)) return value ?? string.Empty;
        value = JwtPattern.Replace(value, "{jwt}");
        value = SecretParamPattern.Replace(value, "$1={redacted}");
        return UuidPattern.Replace(value, "{id}");
    }
}
