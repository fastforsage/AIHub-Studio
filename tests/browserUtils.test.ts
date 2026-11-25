import { describe, expect, it } from "vitest";
import { clampBrowserBounds, normalizeBrowserUrl, profilePartition } from "../src/browser/browserUtils";

describe("normalizeBrowserUrl", () => {
  it("accepts HTTP and HTTPS URLs", () => {
    expect(normalizeBrowserUrl("https://example.com")).toBe("https://example.com/");
    expect(normalizeBrowserUrl("http://localhost:8080/chat")).toBe("http://localhost:8080/chat");
  });

  it("adds HTTPS to a bare hostname", () => {
    expect(normalizeBrowserUrl("example.com")).toBe("https://example.com/");
  });

  it.each(["javascript:alert(1)", "file:///etc/passwd", "data:text/html,hi", "https://user:pass@example.com", ""])(
    "rejects unsafe address %s",
    (value) => expect(normalizeBrowserUrl(value)).toBeNull()
  );
});

describe("profilePartition", () => {
  it("creates a stable persistent partition for a profile", () => {
    const first = profilePartition("provider-profile-1");
    expect(first).toMatch(/^persist:aihub-[a-f0-9]{32}$/);
    expect(profilePartition("provider-profile-1")).toBe(first);
  });

  it("isolates different profiles", () => {
    expect(profilePartition("profile-a")).not.toBe(profilePartition("profile-b"));
  });

  it("rejects an empty profile identifier", () => {
    expect(() => profilePartition(" ")).toThrow("required");
  });
});

describe("clampBrowserBounds", () => {
  it("keeps valid bounds inside the content area", () => {
    expect(clampBrowserBounds(
      { x: 10, y: 20, width: 300, height: 400 }, 1000, 800
    )).toEqual({ x: 10, y: 20, width: 300, height: 400 });
  });

  it("clamps negative positions and oversized dimensions", () => {
    expect(clampBrowserBounds(
      { x: -30, y: -40, width: 5000, height: 6000 }, 1000, 800
    )).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
  });

  it("does not allow a rectangle to extend beyond the window", () => {
    expect(clampBrowserBounds(
      { x: 900, y: 700, width: 500, height: 500 }, 1000, 800
    )).toEqual({ x: 900, y: 700, width: 100, height: 100 });
  });

  it("converts non-finite values into safe zero bounds", () => {
    expect(clampBrowserBounds(
      { x: Number.NaN, y: Number.POSITIVE_INFINITY, width: Number.NaN, height: -1 }, 1000, 800
    )).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});
