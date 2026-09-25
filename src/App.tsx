import { useEffect } from "react";
import { useRota } from "./router";
import { Toasts } from "./components/Toasts";
import { Dialogos } from "./components/Dialogos";
import { desbloquearAudio } from "./lib/sonus";
import { usePub } from "./store/usePub";
import { avisar } from "./components/Dialogos";
import Landing from "./screens/Landing";
import Login from "./screens/Login";
import Mesa from "./screens/Mesa";
import Cozinha from "./screens/Cozinha";
import Bar from "./screens/Bar";
import Garcom from "./screens/Garcom";
import Caixa from "./screens/Caixa";
import Admin from "./screens/Admin";

export default function App() {
  const rota = useRota();

  /* Sessão expirada (12h de plantão): limpa o estado e devolve a equipe ao
     login em vez de deixar a tela mostrando dado velho. */
  useEffect(() => {
    const aoExpirar = () => {
      const { auth, logout } = usePub.getState();
      if (!auth) return; /* 401 de rota pública (QR vencido, por exemplo) */
      logout();
      avisar("Sua sessão expirou. Entre novamente para continuar.", "Sessão encerrada");
    };
    window.addEventListener("pier509-sessao-expirada", aoExpirar);
    return () => window.removeEventListener("pier509-sessao-expirada", aoExpirar);
  }, []);

  /* a voz "desbloqueia" no primeiro toque — igual ao voz-ops.js original */
  useEffect(() => {
    const fn = () => {
      desbloquearAudio();
      window.removeEventListener("pointerdown", fn);
    };
    window.addEventListener("pointerdown", fn);
    return () => window.removeEventListener("pointerdown", fn);
  }, []);

  return (
    <>
      <Toasts />
      <Dialogos />
      {rota.path === "home" && <Landing />}
      {rota.path === "login" && <Login />}
      {rota.path === "mesa" && <Mesa key={rota.params.token} token={rota.params.token || ""} />}
      {rota.path === "cozinha" && <Cozinha />}
      {rota.path === "bar" && <Bar />}
      {rota.path === "garcom" && <Garcom key={rota.params.token} token={rota.params.token || ""} />}
      {rota.path === "caixa" && <Caixa />}
      {rota.path === "admin" && <Admin />}
      {!["home", "login", "mesa", "cozinha", "bar", "garcom", "caixa", "admin"].includes(rota.path) && <Landing />}
    </>
  );
}
