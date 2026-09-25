# Protocolo de colaboração — Pier 509

**Repo:** https://github.com/deividjmoura/pier-509
**Produção:** https://pier509.com.br
**Branch de verdade:** `main`

Este arquivo é o contrato de trabalho para humanos e agentes neste repositório. Ele descreve como
entregar sem quebrar o que já funciona; não é histórico de conversa.

---

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

- Rate-limit em memória: não é compartilhado entre múltiplas instâncias.
- Impressão de cupom é pelo diálogo do navegador (`window.print()`), sem integração com
  impressora de rede.
- Fotos do cardápio aceitam URL remota com bloqueio de SSRF; não há CDN própria.
- Sem gateway bancário: o PIX é estático e a baixa é confirmada pelo caixa.
