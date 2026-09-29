import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifestJson from "./manifest.json";
import { withBuildManifest } from "./src/lib/extManifestEnv";

const manifest = withBuildManifest(manifestJson, {
  apiBase: process.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000",
  name: process.env.VITE_EXT_NAME,
  stripDevHosts: process.env.VITE_STRIP_DEV_HOSTS === "1",
});

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    rollupOptions: {
      input: {
        popup: "index.html",
        oauthFinish: "oauth-finish.html",
      },
    },
  },
});
