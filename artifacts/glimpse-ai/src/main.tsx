import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";

// Wire the JWT from localStorage to every API call's Authorization header
setAuthTokenGetter(() => localStorage.getItem("glimpse_token"));

// Vercel hosts the frontend separately from the API in production.
setBaseUrl(import.meta.env.VITE_API_URL || null);

createRoot(document.getElementById("root")!).render(<App />);
