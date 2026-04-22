import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setAuthTokenGetter } from "@workspace/api-client-react";

// Demo mode: intercept API calls on static hosting (GitHub Pages)
if (import.meta.env.VITE_DEMO_MODE === "true") {
  const { installDemoInterceptor } = await import("./lib/demo-api");
  installDemoInterceptor();
}

// Wire the JWT from localStorage to every API call's Authorization header
setAuthTokenGetter(() => localStorage.getItem("glimpse_token"));

createRoot(document.getElementById("root")!).render(<App />);
