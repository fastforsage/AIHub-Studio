export function formatBuildLabel(version: string, build: string): string {
  const normalizedVersion = version.trim().replace(/^v/i, "");
  if (!normalizedVersion) {
    throw new Error("Application version must not be empty");
  }

  const normalizedBuild = build.trim() || "local";
  return normalizedBuild.toLowerCase() === "local"
    ? `v${normalizedVersion} · local build`
    : `v${normalizedVersion} · build ${normalizedBuild}`;
}
