import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { aplicarTema, temaAtual } from "./lib/tema";

/* aplica o tema salvo antes do primeiro paint */
aplicarTema(temaAtual());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
