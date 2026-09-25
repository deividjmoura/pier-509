/* Tema antes do primeiro paint — evita "flash" claro/escuro ao abrir.
   Valores canônicos: "claro" | "escuro" (aceita os legados "light"/"dark").
   Precisa rodar de forma síncrona, antes do CSS pintar a página. */
(function () {
  function normalizar(v) {
    if (v === "escuro" || v === "dark") return "escuro";
    if (v === "claro" || v === "light") return "claro";
    return null;
  }
  var tema = null;
  try {
    tema = normalizar(localStorage.getItem("pier509-tema"));
  } catch (e) {
    /* armazenamento bloqueado: segue para a preferência do sistema */
  }
  if (!tema) {
    tema =
      window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "escuro"
        : "claro";
  }

  var root = document.documentElement;
  root.setAttribute("data-theme", tema);
  root.classList.toggle("dark", tema === "escuro");
  root.classList.toggle("tema-escuro", tema === "escuro");
  root.classList.toggle("tema-claro", tema === "claro");

  /* Fallback inline das variáveis críticas: se o CSS do deploy estiver em
     cache antigo, a página ainda troca de cor. */
  var claro = {
    "--p509-page": "#e9dcc0",
    "--p509-text": "#2b2113",
    "--p509-white": "#f8f1de",
    "--p509-vidro": "rgba(248, 241, 222, 0.86)",
  };
  var escuro = {
    "--p509-page": "#060f1d",
    "--p509-text": "#f0f6fd",
    "--p509-white": "#10233a",
    "--p509-vidro": "rgba(16, 35, 58, 0.82)",
  };
  var vars = tema === "escuro" ? escuro : claro;
  for (var k in vars) {
    if (Object.prototype.hasOwnProperty.call(vars, k)) {
      root.style.setProperty(k, vars[k]);
    }
  }

  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", tema === "escuro" ? "#060f1d" : "#e9dcc0");
})();
