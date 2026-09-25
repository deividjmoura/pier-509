import { useEffect, useState } from "react";
import { ir } from "../router";
import { usePub } from "../store/usePub";
import type { Role } from "../lib/types";

/**
 * Guarda de acesso das telas de operação.
 *
 * Problema que isto resolve: a tela redirecionava para /login sempre que o
 * `sessionStorage` estava vazio — o que acontece em toda aba nova, mesmo com o
 * cookie de sessão do servidor ainda válido (12 h). A equipe era obrigada a
 * digitar a senha de novo a cada aba aberta.
 *
 * Agora, quando não há papel no dispositivo, perguntamos ao servidor
 * (/api/me) antes de decidir: só manda para o login se o cookie também
 * não valer. Enquanto isso, devolve `checando` para a tela segurar o render.
 */
export function useGuarda(papeis: Role[]) {
  const auth = usePub((s) => s.auth);
  const hydrateMe = usePub((s) => s.hydrateMe);
  const [checando, setChecando] = useState(!auth);

  useEffect(() => {
    if (auth) {
      setChecando(false);
      return;
    }
    let vivo = true;
    void hydrateMe()
      .catch(() => null)
      .finally(() => {
        if (vivo) setChecando(false);
      });
    return () => {
      vivo = false;
    };
  }, [auth, hydrateMe]);

  const papelValido = Boolean(auth && papeis.includes(auth.role));

  useEffect(() => {
    if (checando || papelValido) return;
    if (!auth) {
      ir("/login");
      return;
    }
    /* logado no papel errado: manda para a casa do papel dele */
    ir(auth.role === "admin" ? "/admin" : auth.role === "cozinha" ? "/cozinha" : auth.role === "bar" ? "/bar" : "/caixa");
  }, [checando, papelValido, auth]);

  return { auth, checando, liberado: papelValido };
}
