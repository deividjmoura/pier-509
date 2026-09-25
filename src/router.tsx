import { useEffect, useState } from "react";

/* Router hash minimalista — rotas: #/ · #/login · #/mesa/:token · #/cozinha · #/bar ·
   #/garcom/:token · #/caixa · #/admin */

export interface Rota {
  path: string;
  params: Record<string, string>;
}

function parse(): Rota {
  const h = window.location.hash.replace(/^#/, "") || "/";
  const [pathPart] = h.split("?");
  const segs = pathPart.split("/").filter(Boolean);
  const params: Record<string, string> = {};
  if (segs[0] === "mesa" && segs[1]) params.token = decodeURIComponent(segs[1]);
  if (segs[0] === "garcom" && segs[1]) params.token = decodeURIComponent(segs[1]);
  return { path: segs[0] || "home", params };
}

export function useRota(): Rota {
  const [rota, setRota] = useState<Rota>(parse);
  useEffect(() => {
    const fn = () => {
      setRota(parse());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  return rota;
}

export const ir = (para: string) => {
  window.location.hash = para;
};

/* relógio p/ tempos decorridos */
export function useAgora(intervalo = 1000): number {
  const [n, setN] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setN(Date.now()), intervalo);
    return () => clearInterval(t);
  }, [intervalo]);
  return n;
}
