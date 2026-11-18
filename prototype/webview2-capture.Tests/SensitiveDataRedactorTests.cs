using AIHub.WebView2Capture;
using Xunit;

namespace AIHub.WebView2Capture.Tests;

public sealed class SensitiveDataRedactorTests
{
    [Theory]
    [InlineData("https://chat.qwen.ai/auth#access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature-value", "access_token={redacted}")]
    [InlineData("https://accounts.google.com/o/oauth2?code=4%2Fsecret-code&state=secret-state", "code={redacted}&state={redacted}")]
    [InlineData("https://example.test/c/local-chatgpt%3A8ffac9ab-13b1-4d9a-bd9a-ee1585a8f98d", "local-chatgpt%3A{id}")]
    [InlineData("https://example.test/auth#id_token=header.payload.signature&nonce=n-123&code_challenge=challenge", "id_token={redacted}&nonce={redacted}&code_challenge={redacted}")]
    public void RedactsSecretsAndUuid(string input, string expectedFragment)
    {
        var result = SensitiveDataRedactor.Redact(input);
        Assert.Contains(expectedFragment, result);
        Assert.DoesNotContain("eyJhbGci", result);
        Assert.DoesNotContain("secret-code", result);
        Assert.DoesNotContain("secret-state", result);
        Assert.DoesNotContain("8ffac9ab-13b1-4d9a-bd9a-ee1585a8f98d", result);
    }

    [Theory]
    [InlineData("cfRay=abc123")]
    [InlineData("git-SHA=96c7372f8f24eb795124d5cbe8b9487b304f817f")]
    [InlineData("dom-user-0-9ef2957d-1")]
    [InlineData("fallback-turn-0:1:assistant")]
    [InlineData("response_type=code")]
    [InlineData("contentHash=dae55eff")]
    public void PreservesNonSecretIdentifiers(string input)
        => Assert.Equal(input, SensitiveDataRedactor.Redact(input));

    [Fact]
    public void RedactsRawJwtOutsideUrl()
    {
        const string jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature-value";
        var result = SensitiveDataRedactor.Redact("payload=" + jwt);
        Assert.DoesNotContain(jwt, result);
        Assert.Contains("{jwt}", result);
    }

    [Fact]
    public void HandlesNullAndEmpty()
    {
        Assert.Equal(string.Empty, SensitiveDataRedactor.Redact(null));
        Assert.Equal(string.Empty, SensitiveDataRedactor.Redact(string.Empty));
    }
}
