# Protocolo de colaboração — Pier 509

**Repo:** https://github.com/deividjmoura/pier-509
**Produção:** https://pier509.com.br
**Branch de verdade:** `main`

Este arquivo é o contrato de trabalho para humanos e agentes neste repositório. Ele descreve como
entregar sem quebrar o que já funciona; não é histórico de conversa.

---

## ▶ Estado atual (2026-09-25) — mensagem para quem continuar

**Leia [`HANDOFF.md`](./HANDOFF.md) primeiro**: lá estão o ambiente local (incluindo como subir
Postgres sem `psql`), as suítes com o resultado esperado, as armadilhas que já custaram tempo e as
pendências. Resumo:

- Último commit desta linha de trabalho: `9b7fb0c` (branch `arena/01a0d8ff-pier-509`, base
  `8356f1a`). CI verde. **Ainda não foi mergeado na `main`** — se você está na `main`, esses
  arquivos (`HANDOFF.md`, `DEPLOY.md`, `db/setor.js`, migration `0017`) podem não existir aí.
- O produto está funcional e validado em **banco novo**, pelo caminho de deploy
  (`npm run start:prod`): smoke, smoke-full, dia inteiro, render 10/10, carga 18/18,
  segurança 35/35, regressões 40/40.
- Esta rodada corrigiu 5 bugs (detalhe e arquivos no `HANDOFF.md`): setor de bebidas em banco
  novo, cobrança sem lista em entrega parcial, 500 vazando erro do Postgres, rate-limit de login
  contando acerto, e aviso de PIX pendente travando sessão fechada.
- **Não "conserte" o que parece estranho sem ler o porquê**: o bloqueio de login na 9ª senha
  errada, o 409 de "Nenhum item pronto para entrega" e o 409 de transição de status são
  comportamentos corretos com teste cobrindo.

## Regras não negociáveis

1. **Trabalho vai para a `main`.** Push direto ou PR mergeado no mesmo ciclo. Branch solta não
   entra em produção.
2. **Mudou front → rode `npm run build` e comite `dist/` junto.** O servidor serve `dist/`, não o
   fonte; `dist/` desatualizado é bug visível para o cliente.
3. **`npm run typecheck` antes de qualquer PR.** O `vite build` *não* checa tipos.
4. **Nunca comite `.env`.** Senhas, `DATABASE_URL` e `PIX_CHAVE` ficam fora do Git.
5. **`public/uploads/` é dado do cliente.** Não versionar, não apagar.

---

## Marca (não inventar outra)

- Nome: **Pier 509** · assinatura: *Pier 509 · Lanchonete & Pub*
- Instagram: [@pier.509](https://www.instagram.com/pier.509/) · domínio: `https://pier509.com.br`
- Fonte única de marca: `src/lib/marca.ts`. Textos, selo, rodapés e links saem de lá.
- Paleta: tema **escuro de taverna** (`#060f1d`, ouro `#d9a63f`, teal `#4fd0a8`) e tema **claro de
  pergaminho** (`#e9dcc0`, tinta `#2b2113`, ouro `#a9791f`). Variáveis `--p509-*` em
  `src/index.css`, espelhadas em `src/lib/tema.ts` e `public/tema-inicial.js` — os três andam
  juntos.
- Ornamentos: `placa-madeira`, `borda-corda`, `cantos-mapa`, `stroke-text`, `text-ouro`,
  `animate-marquee`, `animate-balancar` (definidos em `src/index.css`).
- Não reintroduzir nomes, logos, chaves, rodapés ou títulos de versões anteriores do produto.

---

## Arquitetura em 30 segundos

```text
dist/ + public/  → servidos por server.js (Node HTTP nativo, sem framework)
src/             → React 19 + Vite + Tailwind 4 + Zustand
src/store/usePub.ts  → estado global, mutações otimistas com rollback, SSE
db/              → Postgres: migrations idempotentes, queries, auth, pedidos, PIX, eventos
```

- Router por **hash** (`/#/cozinha`). O servidor redireciona os paths sem hash (QR antigos).
- Sessão de equipe: cookie httpOnly `pier509_session` (12 h). As telas de operação usam
  `useGuarda()` (`src/lib/guarda.ts`), que **consulta `/api/me` antes de mandar para o login** —
  aba nova com cookie válido não pede senha de novo.
- Autorização é sempre do servidor (`db/auth.js`, `exigirAcesso`); o front só decide o que
  mostrar.
- PIX tem fonte única de normalização (`db/pix-normaliza.js`). Não duplicar validação em outro
  arquivo.
- CSP de produção **não permite script inline**: o boot do tema é `/tema-inicial.js`. Mantenha
  assim.

---

## Convenções

- Textos do produto em **português do Brasil**, diretos, sem jargão técnico na cara do cliente.
- Nada de `alert()`/`confirm()` nativos nas telas: use `avisar()` e `confirmar()`
  (`src/components/Dialogos.tsx`).
- Erros de API viram toast (`lastError` no store) — não engolir exceção silenciosamente.
- Migrations: sempre idempotentes e numeradas em sequência (`db/migrations/0017_...`).
- Toda correção relevante entra com teste em `tests/regressions.cjs` (regressão) ou
  `tests/render.cjs` (tela renderizada).
- Comentário explica **por quê**, não o quê. Se o bug foi sutil, registre o sintoma.

---

## Checklist antes de entregar

```bash
npm run typecheck                 # tipos
npm run build                     # dist/ atualizado
npm run test:regression           # regressões
node tests/render.cjs             # telas renderizam (precisa da API no ar)
node --check server.js            # sintaxe do servidor
```

Depois, com banco e API no ar: `npm run test:smoke`, `npm run test:full`, `npm run test:dia`.
`test:seguranca` com a API recém-iniciada (ele mexe em rate-limit) e `test:carga` com seed novo.

---

## Pendências conhecidas (não são bugs do produto)

> Continuação da auditoria de 2026-09-25 (tudo o que sobrou):
> 1. **Deploy no host** — `DEPLOY.md` passo a passo; banco novo gerenciado; trocar a senha do
>    staff depois; `npm run start:prod` já foi validado contra banco vazio.
> 2. **Logo do Pier 509** — o cliente avisou que a imagem enviada não serve como logo (fora de
>    formato). Hoje a marca é tipográfica (`src/lib/marca.ts`).
> 3. **Conferência visual no host** — no ambiente de desenvolvimento as fontes do Google não
>    carregam; a tipografia final só dá para julgar publicado.
> 4. **Antes de rodar 2+ instâncias** — mover rate-limit (`db/rateLimit.js`) e SSE
>    (`db/events.js`) para Redis/Upstash; hoje são em memória por processo.


- Rate-limit em memória: não é compartilhado entre múltiplas instâncias.
- Impressão de cupom é pelo diálogo do navegador (`window.print()`), sem integração com
  impressora de rede.
- Fotos do cardápio aceitam URL remota com bloqueio de SSRF; não há CDN própria.
- Sem gateway bancário: o PIX é estático e a baixa é confirmada pelo caixa.
