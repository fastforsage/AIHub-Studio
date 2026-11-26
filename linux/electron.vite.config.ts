import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";

const packageMetadata = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as { version: string };
const buildNumber = process.env.AIHUB_BUILD_NUMBER?.trim() || "local";

export default {
  main: {
    build: {
      // Bergamot is ESM-only. Bundle the provider and its core interface into
      // the CommonJS Electron main entry instead of requiring them from app.asar.
      externalizeDeps: {
        exclude: [
          "@molecule/api-ai-translation",
          "@molecule/api-ai-translation-bergamot"
        ]
      }
    }
  },
  preload: {},
  renderer: {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(packageMetadata.version),
      __APP_BUILD__: JSON.stringify(buildNumber)
    }
  }
};
