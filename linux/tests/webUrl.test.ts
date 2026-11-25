import { describe, expect, it } from "vitest";
import { normalizeWebsiteUrl } from "../src/shared/webUrl";

describe("normalizeWebsiteUrl", () => {
  it("adds HTTPS when a website is entered without a scheme", () => {
    expect(normalizeWebsiteUrl("example.com")).toBe("https://example.com/");
  });

  it("preserves an explicit HTTP URL and its path", () => {
    expect(normalizeWebsiteUrl("http://localhost:8080/chat"))
      .toBe("http://localhost:8080/chat");
  });

  it("trims whitespace", () => {
    expect(normalizeWebsiteUrl("  https://example.com  ")).toBe("https://example.com/");
  });

  it.each(["", "   ", "javascript:alert(1)", "file:///etc/passwd", "data:text/html,hi"])(
    "rejects unsafe or empty input: %s",
    (value) => {
      expect(normalizeWebsiteUrl(value)).toBeNull();
    }
  );

  it("rejects URLs containing embedded credentials", () => {
    expect(normalizeWebsiteUrl("https://user:secret@example.com")).toBeNull();
  });

  it("rejects malformed URLs", () => {
    expect(normalizeWebsiteUrl("https://[broken")).toBeNull();
  });
});
