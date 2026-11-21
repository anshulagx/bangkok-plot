import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { logger } from "./logger.js";
import "./styles.css";

createRoot(document.getElementById("root"), {
  onUncaughtError(error, { componentStack }) {
    logger.error("Application render failed", { error, componentStack });
  },
  onRecoverableError(error, { componentStack }) {
    logger.warn("Application recovered from a render error", {
      error,
      componentStack,
    });
  },
}).render(<App />);
