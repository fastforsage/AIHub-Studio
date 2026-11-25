import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";

const packageMetadata = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as { version: string };
const buildNumber = process.env.AIHUB_BUILD_NUMBER?.trim() || "local";

export default {
  main: {},
  preload: {},
  renderer: {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(packageMetadata.version),
      __APP_BUILD__: JSON.stringify(buildNumber)
    }
  }
};
