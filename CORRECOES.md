# Correções aplicadas — Pier 509

Registro do que foi corrigido em relação à base anterior, com o sintoma que cada mudança resolve.
Serve para não reabrir a mesma ferida.

## Sessão da equipe (crítico)

- **Sintoma:** ao abrir `/admin`, `/cozinha`, `/bar` ou `/caixa` em uma aba nova, mesmo com o
  cookie de sessão válido, a tela caía no login.
- **Causa 1:** cada tela fazia `if (!auth) ir("/login")` no primeiro efeito, antes de o estado ser
  hidratado — o `sessionStorage` (por aba) estava vazio, então o redirect acontecia sempre.
  **Causa 2:** `hydrateMe()` lia `me.papel`, mas `/api/me` responde `{ staff: {...}, home }`. A
  sessão nunca era restaurada de fato.
- **Correção:** `src/lib/guarda.ts` (`useGuarda`) pergunta ao servidor antes de decidir; a tela
  mostra a marca enquanto isso. `api.me()` e `hydrateMe()` passaram a entender o formato real da
  resposta, incluindo `staff`.
- **Teste:** `tests/render.cjs` cobre com e sem cookie (10 checagens).

## Marca e identidade

- Removidas todas as referências à marca anterior em código, HTML, manifest, package, scripts de
  impressão, rodapés, User-Agent de download de foto, cookie de sessão, chaves de armazenamento
  e documentação.
- Cookie de sessão renomeado para `pier509_session`; a migração de chave antiga de tema foi
  removida em vez de mantida.
- Selo e OG image próprios (`public/assets/marca/`), favicons e manifest.

## Interface

- Tema pirata: escuro de taverna com doodles dourados desenhados à mão e claro de pergaminho; a
  operação e o comando usam mapa do cais ao fundo.
- Boot do tema movido para `/tema-inicial.js` (arquivo externo) — a CSP de produção não permite
  script inline; a variável crítica é aplicada antes do primeiro paint.
- `alert()`/`confirm()` nativos das telas substituídos por diálogos da marca
  (`avisar`/`confirmar`), preservando a quebra de linha e a confirmação destrutiva.
- App estático antigo removido de `public/`. Sem `dist/`, o servidor responde uma página de aviso
  em vez de servir uma interface desatualizada e fora da marca.

## Plataforma

- `public/uploads/` continua fora do Git; `data/db.json` permanece como fonte do seed.
- Rodapés de impressão, relatório e comanda usam a fonte única da marca (`src/lib/marca.ts`).
- Seed cria o estabelecimento como **Pier 509** (antes, nome genérico de demonstração).

## Verificações desta entrega

- `npm run typecheck`: limpo.
- `npm run build`: `dist/` regerado.
- `npm run test:regression`: 34/34 (inclui boot do tema externo, ausência de resquício de marca,
  PIX, SSE e autorizações).
- `node tests/render.cjs`: 10/10 telas (landing, login, mesa, garçom, cozinha, bar, caixa, comando,
  rota desconhecida e bloqueio sem sessão).
- `npm run test:smoke`, `test:full`, `test:dia`, `test:seguranca` e `test:carga` contra Postgres
  local + API real.
- Sem verificação visual em navegador real neste ambiente (não foi possível instalar navegador);
  a checagem de UI é feita por render em DOM (jsdom) + build de produção.
