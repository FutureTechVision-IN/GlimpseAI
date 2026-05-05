import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import { bootstrapTheme } from "./lib/theme";

// Apply the persisted theme as early as possible to avoid a flash of
// wrong palette when the page hydrates.
bootstrapTheme();

// Demo mode: intercept API calls on static hosting (GitHub Pages)
if (import.meta.env.VITE_DEMO_MODE === "true") {
  const { installDemoInterceptor } = await import("./lib/demo-api");
  installDemoInterceptor();
}

const apiBaseUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
if (apiBaseUrl) {
  setBaseUrl(apiBaseUrl);
}

// Wire the JWT from localStorage to every API call's Authorization header
setAuthTokenGetter(() => localStorage.getItem("glimpse_token"));

createRoot(document.getElementById("root")!).render(<App />);
