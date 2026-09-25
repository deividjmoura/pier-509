<div align="center">

<img src="public/assets/marca/selo-256.png" alt="Pier 509" width="132" />

# PIER 509

**Lanchonete & Pub** · comanda digital por QR Code

Do celular do cliente até a chapa, o balcão e o caixa — em tempo real.

`https://pier509.com.br` · Instagram [@pier.509](https://www.instagram.com/pier.509/)

</div>

---

## O que é

Sistema operacional completo para atendimento por mesa. O cliente escaneia o QR da mesa, monta o
pedido no próprio celular (sem instalar nada) e a tripulação acompanha cada etapa em telas
dedicadas. A **comanda é acumulativa**: vários pedidos na mesma visita, um único fechamento no
caixa.

Visual **pirata**: tema escuro de taverna (doodles dourados traçados à mão) e tema claro de
pergaminho, com mapa do cais ao fundo na operação e nas telas de comando.

---

## Fluxo

```text
Cliente (QR)  →  Cozinha / Bar  →  Garçom  →  Caixa
   pedido           preparo         entrega    fecha + PIX
```

Itens só entram no total da conta depois de **entregues**. O caixa fecha a **sessão** (comanda),
não o pedido isolado.

---

## Telas

| Papel   | Rota              | Função principal                                      |
|---------|-------------------|-------------------------------------------------------|
| Salão   | `/`               | Apresentação, cardápio e QR das mesas                 |
| Cliente | `/mesa/:token`    | Cardápio, pedido, conta da sessão, PIX                |
| Garçom  | `/garcom/:token`  | Entrega total ou parcial dos itens prontos            |
| Cozinha | `/cozinha`        | Fila da chapa + alerta de voz                         |
| Bar     | `/bar`            | Fila do balcão + alerta de voz                        |
| Caixa   | `/caixa`          | Pagamentos, divisão de conta, PIX, fechamento         |
| Comando | `/admin`          | Dashboard, cardápio, mesas, garçons, funções, relatórios |
| Equipe  | `/login`          | Acesso por papel (admin, cozinha, bar, caixa)         |

O app é um SPA com rotas em hash (`/#/admin`). O servidor redireciona `/admin`, `/caixa`,
`/cozinha`, `/bar`, `/mesa/:token` e `/garcom/:token` para a rota equivalente — QR já impressos
continuam funcionando.

---

## Funcionalidades

### Cliente (mesa)
- Cardápio por categoria, busca e destaques
- Produtos simples, com **adicionais/removíveis** e tipo **Escolher** (tamanho/sabor)
- Carrinho, comanda acumulativa e conta em tempo real
- **PIX** estático (BR Code EMV + copia-e-cola) e aviso **“Já paguei no PIX”**
- Nome do cliente por mesa, sem cadastro e sem app

### Cozinha e Bar
- Filas separadas por **setor** de produção
- Aceitar/concluir com um toque e **alerta de voz** (“pedido novo, mesa N, cliente”)
- Indicador de conexão ao vivo

### Garçom
- Acesso por token próprio (link/QR individual)
- Entrega **total ou parcial**, com beep e voz quando há item pronto

### Caixa
- Comandas abertas, valores a receber e consumo em aberto
- Pagamentos parciais, **divisão de conta**, desconto e taxa
- Confirmação de avisos de PIX (toast + som + voz)
- Fechamento da sessão com forma de pagamento

### Comando (admin)
- Dashboard do dia e da semana (faturamento, ticket médio, top produtos)
- Cardápio: categorias, produtos, ordem, estoque e fotos
- Mesas com QR fixo, garçons com token, funções da equipe
- Relatório por período, histórico de pedidos e limpeza de dados antigos

### Plataforma
- Login por papel com sessão em cookie httpOnly (12 h) e CSRF por `Origin`
- Atualização ao vivo por **SSE** (`/api/events`) com isolamento por token
- Postgres com migrations idempotentes + seed
- Tema claro/escuro persistido, aplicado antes do primeiro paint (`/tema-inicial.js`)
- PWA-instalável (manifest + ícones), sem build de app nativo

---

## Stack

| Camada     | Tecnologia                                                        |
|------------|-------------------------------------------------------------------|
| Front      | React 19 · Vite 7 · TypeScript · Tailwind 4 · Zustand · Framer Motion |
| API        | Node.js (HTTP nativo, sem framework)                              |
| Dados      | PostgreSQL 16+ (Neon, Render, Railway ou local)                   |
| Tempo real | Server-Sent Events                                                |
| Imagens    | Sharp (WebP, limite de tamanho e bloqueio de SSRF)                |

---

## Rodando localmente

```bash
npm ci                 # dependências
cp .env.example .env   # ajuste DATABASE_URL, PORT e a senha do seed
npm run db:migrate     # cria/atualiza o schema (idempotente)
npm run db:seed        # cardápio, mesas, garçons e usuários da equipe
npm run build          # gera dist/ (o servidor serve dist/, não o fonte)
npm start              # API + UI em http://localhost:3000
```

Durante o desenvolvimento, com recarga do front:

```bash
npm run dev            # Vite em :5173 (faz proxy de /api e /uploads para :3000)
npm run dev:api        # API em :3000 em outro terminal
```

Sem `dist/` o servidor responde com uma página de aviso em vez de servir interface antiga —
rode `npm run build`.

### Variáveis de ambiente

| Variável | Para que serve |
|----------|----------------|
| `DATABASE_URL` | Conexão Postgres (SSL é normalizado automaticamente) |
| `DATABASE_SSL` / `DATABASE_SSL_REJECT_UNAUTHORIZED` | SSL explícito e validação de certificado |
| `PORT` | Porta do servidor (padrão 3000) |
| `STAFF_SEED_PASSWORD` | Senha inicial de admin/cozinha/bar/caixa (mínimo 12 em produção) |
| `PIX_CHAVE` / `PIX_NOME` / `PIX_CIDADE` | Dados do PIX estático (chave validada e normalizada) |
| `APP_TIMEZONE` | Fuso do dashboard e relatórios (`America/Sao_Paulo`) |
| `CSRF_ALLOWED_ORIGINS` | Origens extras aceitas em mutações autenticadas |
| `MAX_BODY_BYTES`, `FOTO_*`, `CARDAPIO_CACHE_TTL_MS`, `PG_POOL_MAX` | Ajustes finos de corpo, upload, cache e pool |

`.env` nunca vai para o Git.

---

## Testes

| Comando | O que cobre |
|---------|-------------|
| `npm run typecheck` | TypeScript estrito (o build do Vite não checa tipos) |
| `npm run test:regression` | 34 regressões: tema/boot, SSE, PIX, validações, auth, marca |
| `npm run test:smoke` | API viva: login, cardápio, mesas, pedido ponta a ponta |
| `npm run test:full` | Fluxo completo: pedido → cozinha → garçom → caixa |
| `npm run test:dia` | Um dia inteiro de operação concorrente (multi-mesa, PIX, caixa) |
| `npm run test:carga` | Concorrência e limites (precisa de banco recém-semeado) |
| `npm run test:seguranca` | 35 checagens de auth, CSRF, rate-limit e isolamento |
| `node tests/render.cjs` | Renderiza cada tela em DOM real (jsdom) contra a API e confere textos |

`test:seguranca` mexe em rate-limit: rode com a API recém-iniciada. `test:carga` pede seed
recente. Ambos são de ambiente, não bugs do produto.

---

## Deploy

1. Banco Postgres com `DATABASE_URL` configurada (SSL conforme o provedor).
2. `NODE_ENV=production` e `STAFF_SEED_PASSWORD` forte (≥12 caracteres) — sem isso o bootstrap de
   usuários é recusado de propósito.
3. `npm run build` gera `dist/`; `npm start` sobe API + UI na mesma porta.
4. Migrations rodam automaticamente no boot (best-effort). Para exigir sucesso antes de aceitar
   tráfego, use `npm run start:prod`.
5. Depois do deploy, valide `/`, `/login`, uma mesa e o toggle de tema com recarga (hard refresh).

CI (`.github/workflows/ci.yml`) roda instalação, typecheck, build, integridade de `dist/`,
regressões e `node --check` em `server.js`/`db/`/`scripts/`.

---

## Estrutura

```text
src/                 front React (telas, componentes, store, libs)
  components/        ui.tsx (Selo, Btn, Modal…), OpsShell, Dialogos, Toasts
  lib/               marca.ts (fonte única da marca), tema.ts, api.ts, print.ts, sonus.ts
  screens/           Landing, Login, Mesa, Garcom, Cozinha, Bar, Caixa, Admin
  store/usePub.ts    estado + SSE + mutações otimistas
  index.css          tema pirata (variáveis --p509-*), classes de ornamento
public/              ícones, selo, doodles, mapa, pergaminho, tema-inicial.js, manifest
  assets/marca/      selo da marca (png/webp) + OG image
  assets/pirata/     doodles, mapa e pergaminho (webp servido + jpg mestre leve)
  assets/demo/       fotos de demonstração do cardápio
db/                  pool, migrations, queries, auth, pedidos, PIX, eventos (SSE)
scripts/             seed auxiliar, testes de API/carga/segurança, reset de senha
tests/               regressões (node:test) + render de telas (jsdom + esbuild)
```

---

## Status

| Área                                   | Situação  |
|----------------------------------------|-----------|
| Pedido por QR + comanda acumulativa    | Pronto    |
| Cozinha / Bar / Garçom / Caixa         | Pronto    |
| PIX (QR + aviso ao caixa)              | Pronto    |
| Divisão de conta, desconto e taxa      | Pronto    |
| Comando + dashboard + relatórios       | Pronto    |
| Tema pirata claro/escuro               | Pronto    |
| Gateway de pagamento bancário          | Planejado |
| Impressão em rede / impressora térmica | Cupom no navegador (Ctrl+P) |
| Multi-loja / WhatsApp                  | Planejado |

---

<div align="center">

**PIER 509** · Lanchonete & Pub
[@pier.509](https://www.instagram.com/pier.509/) · desenvolvimento [Deivid Moura DEV](https://github.com/deividjmoura)

</div>
