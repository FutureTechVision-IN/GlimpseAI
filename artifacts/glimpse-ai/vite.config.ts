import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// PORT is only needed for the dev/preview server, not for production builds
const rawPort = process.env.PORT;
const isBuildCommand = process.argv.some((a) => a === "build");

if (!rawPort && !isBuildCommand) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort ?? "5000");

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// BASE_PATH defaults to "/" for production builds (e.g. Vercel)
const basePath = process.env.BASE_PATH ?? (isBuildCommand ? "/" : undefined);

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

const apiProxyTarget = process.env.API_PROXY_TARGET;

export default defineConfig({
  base: basePath,
  // Store the dep-optimization cache on local disk so it is never blocked
  // by OneDrive cloud-placeholder I/O, which causes Vite to hang on startup.
  cacheDir: "/tmp/vite-cache/glimpse-ai",
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,   // fail loudly instead of silently using port+1
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: apiProxyTarget
      ? {
          "/api": {
            target: apiProxyTarget,
            changeOrigin: true,
          },
        }
      : undefined,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
