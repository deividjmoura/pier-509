# Passagem de bastão — Pier 509

> Documento para quem continuar este trabalho (agente ou pessoa). Estado, o que já
> está feito, como rodar/verificar e o que falta. **Não é documentação do produto** —
> para instalar e publicar, veja [`DEPLOY.md`](./DEPLOY.md) e o [`README.md`](./README.md).

Atualizado em: 2026-09-25
Branch de trabalho: `arena/01a0d8ff-pier-509` (todo o trabalho fica só nela)
Último commit: `261f020` — *Correções da auditoria de produção (5 bugs reais)*
CI (`gh run list`): verde no push e no PR.

---

## 1. Situação

O app está **funcional e pronto para deploy**. A auditoria de produção cobriu
dinheiro (caixa, PIX parcial, relatório), banco novo, cadastro do admin, login,
impressão, upload de fotos, SSE e as suítes do próprio projeto. Não há bug conhecido
em aberto; o que falta é a publicação no host real (passo seu, descrito no `DEPLOY.md`).

## 2. Correções já aplicadas (não desfazer sem entender)

| # | Bug | Onde foi corrigido |
|---|-----|--------------------|
| 1 | Banco **novo** nascia com todos os produtos em `cozinha` → tela do Bar vazia, bebidas caindo na cozinha | `db/setor.js` (fonte única), `db/seed.js` (grava `setor` no INSERT), `db/migrations/0017_setor_bebidas.sql` |
| 2 | Caixa **cobrava sem listar** o item em pedido com entrega parcial (R$ 30 cobrados, lista vazia) | `db/caixa.js` → `listSessoesAbertas` filtra por item entregue |
| 3 | Login limitava **8 tentativas por IP contando também login correto** → a equipe era bloqueada no meio do turno (mesmo IP da loja) | `db/rateLimit.js` (`golpeExcedido`/`registrarGolpe`/`limparGolpes`) + `server.js` usa só falha de credencial |
| 4 | `POST/PATCH /api/admin/produtos` com categoria inexistente devolvia **500 com a mensagem crua do PostgreSQL** | `db/admin.js` (`exigirCategoria`) + `server.js` converte integridade (classe `23xxx`) em **409 amigável** |
| 5 | Aviso de PIX não confirmado ficava `pendente` numa sessão **fechada** (alerta fantasma + risco de cobrar em dinheiro quem já pagou PIX) | `db/caixa.js` expira no fechamento (`avisosExpirados`) + `src/screens/Caixa.tsx` avisa e pede confirmação |

Complementos: nenhum `alert()`/`confirm()` nativo (quebra em navegador embutido do
Instagram/WhatsApp) — use `avisar()`/`confirmar()` de `src/components/Dialogos.tsx`;
`scripts/teste-carga.js` cria as mesas que faltam (antes **não rodava em banco novo**)
e mantém auditoria de invariantes em SQL; `tests/regressions.cjs` tem 40 testes, 5
deles cobrindo exatamente os bugs acima.

## 3. Ambiente local (este sandbox zera `node_modules`/processos entre sessões)

```bash
cd /home/user/pier-509
npm ci                                  # dependências
# PostgreSQL de teste (não existe psql/createdb no sandbox):
#   binários em /home/user/tools (embedded-postgres), dados em /tmp/pgdata, porta 5433
#   initdb -D /tmp/pgdata -U postgres --auth=trust
#   pg_ctl -D /tmp/pgdata -o "-k /tmp -p 5433" -l /tmp/pg.log start
# criar o banco via script pg.Client (não há createdb)
npm run db:migrate && npm run db:seed   # 17 migrations · espera "setores: bar=47 · cozinha=14"
npm run start:prod                      # caminho de deploy: migra e sobe o servidor (:3000)
```

Banco de referência validado nesta auditoria: `pier509_deploy` (criado do zero).

## 4. Verificação (esperado tudo verde, em banco novo)

| Comando | Resultado esperado |
|---|---|
| `node --test tests/regressions.cjs` | 40/40 |
| `REBUILD_RENDER=1 node tests/render.cjs` | 10 verificações · 0 falhas |
| `npm run test:smoke` / `npm run test:full` | OK / OK sem avisos |
| `npm run test:dia` | OK (avisos só se o banco já tiver sessões sujas) |
| `npm run test:carga` | 18 verificações · 0 falhas (cria mesas se faltarem) |
| `npm run test:seguranca` | 35 verificações · 0 falhas |

## 5. Armadilhas que já custaram tempo

- **Rate-limit do login**: 9 senhas erradas seguidas bloqueiam aquele IP por 10 min
  (correto e proposital). Se um teste começar a receber 429 do nada, **reinicie a API**
  (os contadores são em memória) — não "conserte" afrouxando o limite.
- `db/pool.js` não aceita uso depois de `pool.end()` — nunca feche o pool em script que
  ainda vai consultar o banco (`db/migrate.js` e `scripts/teste-carga.js` têm comentário
  sobre isso).
- Sem `psql`/`pg_dump` no sandbox: use scripts `pg.Client`. Os `pg_dump` do `DEPLOY.md`
  valem para máquina real.
- Testes que abrem pedido precisam de **mesa livre** e a taxa é por `mesa+IP`
  (20/5 min por mesa, 60/5 min por IP): use mesa nova em cada caso.
- Scripts temporários de investigação ficam na **raiz** do repositório e **não** estão
  no `.gitignore`: apague todos (`.tmp-*.cjs`) antes de commitar.
- `dist/` é **versionado**: mudou `src/`, rode `npm run build` e commite o `dist` junto.
- Marca antiga ("QRadmin" e afins) não pode aparecer em **nenhum** arquivo, inclusive
  `dist/`; há teste de regressão varrendo o repositório.

## 6. Próximos passos sugeridos

1. **Deploy no host real** (`DEPLOY.md`): banco novo gerenciado, variáveis
   (`DATABASE_URL`, `STAFF_SEED_PASSWORD`, `PIX_CHAVE`, `PIX_CIDADE`, `APP_TIMEZONE`),
   depois trocar a senha do staff. O caminho `npm run start:prod` já foi validado contra
   banco vazio — falta só o host.
2. **Logo do Pier 509**: o cliente avisou que a imagem enviada não está em formato de
   logo e precisa ser refeita. Hoje a marca é tipográfica (ver `src/lib/marca.ts`).
3. **Conferência visual no deploy**: no sandbox o acesso à internet é restrito e as
   fontes do Google (permitidas na CSP) não carregam — a tipografia final só dá para
   julgar no host publicado.
4. **Escala horizontal**: `db/rateLimit.js` é em memória e os avisos SSE também
   (`db/events.js`). Uma segunda instância do servidor quebra o rate-limit e a
   sincronização em tempo real — antes de escalar, migrar para Redis/Upstash (já
   comentado no topo de `db/rateLimit.js`).
5. **PIX**: a confirmação é manual pelo caixa, por decisão de projeto (não há
   conciliação bancária). Se o cliente quiser automático, é integração nova, não bug.

## 7. Regras do cliente (valem para qualquer mudança)

- Marca = **Pier 509** · Instagram `https://www.instagram.com/pier.509/` ·
  rodapé/dev: **Deivid Moura DEV**.
- Tema **pirata**, bem estilado: mesa = doodles dourados em fundo escuro;
  admin = bordas piratas + fundo de mapa.
- Zero referência à marca anterior (nome, logo, título, chave, rodapé de impressão,
  User-Agent, documentação).
- Textos da interface em **pt-BR**.
