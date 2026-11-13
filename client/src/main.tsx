import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if (!window.location.hash) {
  window.location.hash = "#/";
}

import { isDeviceMode, initDeviceMode } from "./lib/queryClient";

(async () => {
  if (isDeviceMode()) {
    try {
      await initDeviceMode();
    } catch (e) {
      console.error("device engine failed to start", e);
    }
  }
  createRoot(document.getElementById("root")!).render(<App />);
})();
