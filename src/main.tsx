import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./fonts.css";
import "./styles.css";
import "./theme-studio.css";
import "./work.css";
import "./theme-sphere.css";
import { applyTheme } from "./lib/theme";

applyTheme();
registerSW({ immediate: true });

// мек светлинен ефект по картите, който следва показалеца (само с мишка/тъчпад и включени ефекти)
document.addEventListener(
  "pointermove",
  (e) => {
    if (e.pointerType !== "mouse" || document.documentElement.dataset.fx !== "on") return;
    const el = (e.target as HTMLElement | null)?.closest?.(".task") as HTMLElement | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  },
  { passive: true },
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
