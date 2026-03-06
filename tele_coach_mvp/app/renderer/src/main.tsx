import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { applyThemeToDom } from "./lib/theme_tokens";
import "./styles.css";

applyThemeToDom();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
