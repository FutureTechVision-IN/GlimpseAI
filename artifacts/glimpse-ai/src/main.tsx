import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setAuthTokenGetter } from "@workspace/api-client-react";

// Wire the JWT from localStorage to every API call's Authorization header
setAuthTokenGetter(() => localStorage.getItem("glimpse_token"));

createRoot(document.getElementById("root")!).render(<App />);
