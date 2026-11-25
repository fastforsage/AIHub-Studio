const HTTP_PROTOCOL = /^https?:\/\//i;
const EXPLICIT_PROTOCOL = /^[a-z][a-z\d+.-]*:/i;

export function normalizeWebsiteUrl(input: string): string | null {
  const value = input.trim();

  if (!value) return null;

  // Never reinterpret javascript:, file:, data:, or another explicit scheme as HTTPS.
  if (EXPLICIT_PROTOCOL.test(value) && !HTTP_PROTOCOL.test(value)) return null;

  const candidate = HTTP_PROTOCOL.test(value) ? value : "https://" + value;

  try {
    const parsed = new URL(candidate);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname || parsed.username || parsed.password) return null;

    return parsed.toString();
  } catch {
    return null;
  }
}
