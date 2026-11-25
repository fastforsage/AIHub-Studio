import { describe, expect, it } from "vitest";
import { formatBuildLabel } from "../src/shared/versionLabel";

describe("formatBuildLabel", () => {
  it("shows the semantic version and unique CI build number", () => {
    expect(formatBuildLabel("0.1.1", "42.2")).toBe("v0.1.1 · build 42.2");
  });

  it("labels a local development build explicitly", () => {
    expect(formatBuildLabel("v0.1.1", "local")).toBe("v0.1.1 · local build");
  });

  it("treats a missing build number as a local build", () => {
    expect(formatBuildLabel("0.1.1", "  ")).toBe("v0.1.1 · local build");
  });

  it("rejects an empty semantic version", () => {
    expect(() => formatBuildLabel(" ", "42.2")).toThrow("Application version must not be empty");
  });
});
