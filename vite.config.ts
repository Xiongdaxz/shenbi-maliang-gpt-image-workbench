import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import packageJson from "./package.json" with { type: "json" };

const githubPagesBase = "/shenbi-maliang-gpt-image-workbench/";
const buildVersion = process.env.VITE_APP_VERSION_OVERRIDE?.trim() || packageJson.version;

export default defineConfig({
  base: process.env.GITHUB_PAGES === "true" ? githubPagesBase : "/",
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion)
  },
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/files": "http://127.0.0.1:8787"
    }
  },
  build: {
    outDir: "dist",
    cssMinify: "esbuild"
  }
});
