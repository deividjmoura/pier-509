# Pier 509 — do banco novo ao ar (passo a passo)

Guia operacional, na ordem em que se faz: **primeiro o banco, depois o deploy**. Todos os comandos
foram executados contra um PostgreSQL real antes de entrar aqui; onde houver algo específico de
provedor, está marcado.

- Sem `dist/` o servidor avisa e não serve interface antiga (o `dist/` vai no repositório).
- As **migrations rodam sozinhas no boot** do servidor (idempotentes). Ainda assim, em banco novo,
  rodar `db:migrate` e `db:seed` antes de subir evita qualquer surpresa.

---

## Índice

1. [Pré-requisitos](#1-pré-requisitos)
2. [Parte 1 — Banco de dados novo](#parte-1--banco-de-dados-novo)
3. [Parte 2 — Deploy](#parte-2--deploy)
4. [Variáveis de ambiente](#variáveis-de-ambiente)
5. [Checklist pós-deploy](#checklist-pós-deploy)
6. [Problemas comuns](#problemas-comuns)
7. [Rotina de manutenção](#rotina-de-manutenção)

---

## 1. Pré-requisitos

| Item | Versão / observação |
|---|---|
| Node.js | 20 ou 22 (o app roda nos dois) |
| npm | vem com o Node |
| Git | para clonar e publicar |
| PostgreSQL | 14+ (testado em 18) — local, Docker ou gerenciado |
| Domínio | para HTTPS e para os QR das mesas (ex.: `pier509.com.br`) |

```bash
git clone https://github.com/deividjmoura/pier-509.git
cd pier-509
npm ci
```

---

## Parte 1 — Banco de dados novo

### 1.1 Escolher onde o banco vai morar

| Onde | Bom para | O que você vai colar em `DATABASE_URL` |
|---|---|---|
| **Neon** | produção pequena/média, escala a zero, tem branch de banco | `postgresql://usuario:senha@ep-xxx.us-east-1.aws.neon.tech/pier509?sslmode=require` |
| **Render Postgres** | deploy no Render com banco no mesmo lugar | *Internal* `postgresql://...@dpg-xxx-a/pier509` · *External* com `?sslmode=require` |
| **Supabase** | já usa Supabase para outra coisa | `postgresql://postgres.senha@aws-0-xx.pooler.supabase.com:5432/postgres` |
| **Railway** | deploy no Railway com banco no projeto | `${{Postgres.DATABASE_URL}}` (use a *referência*, não copie) |
| **Docker local / VPS** | previsível, dados no seu servidor | `postgres://postgres:senha@127.0.0.1:5432/pier509` |

> O app normaliza `sslmode` sozinho (Neon/Render/Supabase já vêm com `?sslmode=require` e o
> `pool.js` transforma em `verify-full` para não poluir o log com SECURITY WARNING). Você **não**
> precisa editar a URL.

### 1.2 Criar o banco

**Neon** — painel → *New Project* → nome `pier509` → região mais perto (ex.: São Paulo/Ohio) →
*Connect* → copie a *Connection string* (o formato `postgresql://...`).

**Render** — *New* → *Postgres* → nome `pier509-db`, região, plano → depois *Connections* →
copie a *External Database URL* (para rodar migrations da sua máquina).

**Supabase** — *New project* → *Settings → Database* → *Connection string* → aba *URI*.

**Railway** — *New Project* → *Provision PostgreSQL* → aba *Variables* → copie `DATABASE_URL`
(ou referencie `${{Postgres.DATABASE_URL}}` no serviço da aplicação).

**Docker (VPS ou local)** — servidor já pronto na máquina:

```bash
docker run -d --name pier509-db \
  --restart unless-stopped \
  -e POSTGRES_PASSWORD='troque-esta-senha' \
  -e POSTGRES_DB=pier509 \
  -p 127.0.0.1:5432:5432 \
  -v /srv/pier509/pgdata:/var/lib/postgresql/data \
  postgres:18
# DATABASE_URL=postgres://postgres:troque-esta-senha@127.0.0.1:5432/pier509
```

> `-p 127.0.0.1:5432` mantém o banco fechado para a internet. Se a aplicação for Docker na mesma
> rede, use `--network` e o nome do container no lugar de `127.0.0.1`.

### 1.3 Preparar o `.env` local (para aplicar migrations no banco novo)

```bash
cp .env.example .env
```

Conteúdo mínimo para criar o banco (o resto vem depois):

```ini
DATABASE_URL=postgresql://usuario:senha@host:5432/pier509?sslmode=require
PORT=3000
STAFF_SEED_PASSWORD=troque-por-uma-senha-com-12-ou-mais
PIX_CHAVE=seu-cnpj-ou-cpf-ou-email
PIX_NOME=PIER 509
PIX_CIDADE=ITAJAI
APP_TIMEZONE=America/Sao_Paulo
```

Gere uma senha forte de verdade (e guarde no gerenciador de senhas):

```bash
openssl rand -base64 18
```

> `.env` está no `.gitignore`. Nunca comite. Em plataformas, as mesmas chaves vão em *Variables*.

### 1.4 Aplicar o schema

```bash
npm run db:migrate
```

Saída esperada em banco vazio (16 arquivos, um por vez, cada um em transação própria):

```text
▶ Aplicando 0001_init.sql...
  ✅ 0001_init.sql aplicada.
...
✅ 16 migration(s) aplicada(s) com sucesso.
```

Rodar de novo não repete nada: ele consulta a tabela `schema_migrations`:

```text
✅ Nenhuma migration pendente. Banco já está atualizado.
```

### 1.5 Popular o cardápio, mesas e equipe

```bash
npm run db:seed
```

Saída real (banco novo):

```text
✅ Mesas 1–20 garantidas (total no banco: 20).
🧑 Garçom seed criado: Garçom 1 · token b46ceead-53bc-41c1-b41a-a18c013f7efa
✅ 10 categorias inseridas.
📦 Estoque habilitado em 47 produto(s) de bebida.
✅ 61 produtos, 46 adicionais e 0 ingredientes removíveis inseridos.
👤 Staff inicial criado (admin / cozinha / caixa).
```

O que ele cria:

| Item | Detalhe |
|---|---|
| Categorias e produtos | 10 categorias, 61 itens (cardápio de exemplo em `data/db.json`) |
| Mesas | 1 a 20, cada uma com `token` UUID (é o que vai no QR) |
| Garçom | 1 garçom de exemplo com token próprio |
| Equipe | `admin`, `cozinha`, `bar`, `caixa` — todos com a senha de `STAFF_SEED_PASSWORD` |

Repetir o seed **não duplica** cardápio (ele aborta se já existir categoria). Para substituir o
cardápio de propósito: `FORCE_SEED=1 npm run db:seed`.

> A senha de bootstrap precisa ter **≥ 12 caracteres** em produção
> (`NODE_ENV=production`), senão o servidor recusa criar a equipe com 503 — é proteção
> contra instalação no ar com senha fraca.

### 1.6 Depositar o PIX certo

O QR do PIX é montado a partir de `PIX_CHAVE` / `PIX_NOME` / `PIX_CIDADE`. Formatos aceitos para a
chave: CPF, CNPJ, e-mail, telefone `+5511...` ou chave aleatória (EVP) — todos normalizados por
`db/pix-normaliza.js`, a mesma fonte usada pelo front.

Confira antes de subir:

```bash
curl -s http://127.0.0.1:3000/api/config/pix | head -c 400
```

A resposta traz o tipo detectado e, se a chave estiver vazia/ placeholder, o motivo — em vez de um
QR que o cliente não consegue pagar.

### 1.7 Conferir o banco por dentro (opcional, mas recomendado)

```bash
node -e '
require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  for (const q of [
    "SELECT count(*)::int AS migrations FROM schema_migrations",
    "SELECT count(*)::int AS categorias FROM categorias",
    "SELECT count(*)::int AS produtos FROM produtos",
    "SELECT count(*)::int AS mesas FROM mesas",
    "SELECT login, papel, ativo FROM staff ORDER BY id",
  ]) console.table((await pool.query(q)).rows);
  await pool.end();
})();'
```

Esperado: 16 migrations · 10 categorias · 61 produtos · 20 mesas · 4 usuários `ativo = true`.

### 1.8 Antes de gerar os QR das mesas

Os QR apontam para `https://SEU-DOMINIO/#/mesa/<token>`. Ou seja: **configure o domínio antes de
imprimir**. No *Comando → Mesas*, cada mesa tem o QR pronto para copiar/imprimir; o token também
aparece ali. Se o domínio mudar depois, os QR antigos continuam válidos desde que o domínio antigo
siga respondendo (o token é o que importa, não o host).

### 1.9 Backup e restauração

O banco é a **única** fonte de verdade: cardápio, pedidos e **as fotos** (elas são gravadas como
data-URL no Postgres, não em disco). Backup do banco = backup de tudo.

```bash
# Backup completo (formato custom, comprimido)
pg_dump "$DATABASE_URL" --no-owner --no-acl -Fc -f pier509-$(date +%F).dump

# Restaurar em um banco novo/vazio
createdb pier509_restore
pg_restore --no-owner --no-acl -d "postgres://.../pier509_restore" pier509-2026-09-25.dump
```

Neon/Render/Supabase têm backup automático no painel — confirme a retenção do seu plano e faça um
`pg_dump` manual antes de qualquer mudança grande.

### 1.10 E se eu já tenho o banco da versão anterior?

Nada de schema novo nesta versão: as migrations são **as mesmas** (0001–0016). Basta apontar
`DATABASE_URL` para o banco atual — o boot confere e não aplica nada. Ao trocar para esta versão,
atenção apenas a:

1. **Sessões da equipe caem uma vez**: o cookie mudou de nome (`pier509_session`). A equipe entra de
   novo no primeiro acesso após o deploy.
2. **Nome do estabelecimento** no banco antigo pode continuar o anterior — ajuste no *Comando* se
   quiser o nome novo.
3. Faça um `pg_dump` antes, mesmo sendo "só deploy".

---

## Parte 2 — Deploy

### Opção A — Railway (mesma linha do deploy anterior)

1. **Suba o código** para o GitHub (branch `main`).
2. No Railway: *New Project* → *Deploy from GitHub repo* → escolha `pier-509`.
3. *Provision PostgreSQL* no mesmo projeto (se ainda não existe).
4. No serviço da aplicação → *Variables*, adicione:

   ```ini
   NODE_ENV=production
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   STAFF_SEED_PASSWORD=<senha com 12+ caracteres>
   PIX_CHAVE=<sua chave>
   PIX_NOME=PIER 509
   PIX_CIDADE=ITAJAI
   APP_TIMEZONE=America/Sao_Paulo
   ```

5. O `railway.json` já define build (`npm ci && npm run build`), start (`npm start`) e healthcheck
   (`/healthz`). Se preferir manual: *Settings → Build Command* = `npm ci && npm run build`,
   *Start Command* = `npm start`.
6. *Settings → Networking → Generate Domain* (ou aponte seu domínio em *Custom Domain*).
7. Antes do primeiro boot da aplicação em produção, aplique as migrations **no banco do Railway**
   (do seu computador, com a *External* URL):

   ```bash
   DATABASE_URL="postgresql://...railway.../railway" STAFF_SEED_PASSWORD="<mesma senha>" npm run db:migrate
   DATABASE_URL="postgresql://...railway.../railway" STAFF_SEED_PASSWORD="<mesma senha>" npm run db:seed
   ```

   (O servidor também roda migrations sozinho no boot; fazer antes só garante que o primeiro acesso
   já encontre cardápio e equipe.)

8. *Deploy* → acompanhe os logs: `⚓ Pier 509 — comanda digital`, `🧬 Migrations verificadas`,
   e `Staff inicial criado` na primeira vez.

> **Não precisa de volume**: as fotos vão para o banco. O único diretório de escrita é
> `public/uploads`, usado só quando `FOTO_ALSO_DISK=1` (desnecessário em produção).

### Opção B — Render (blueprint pronto)

O repositório traz `render.yaml` com banco + serviço web + healthcheck.

1. *New* → *Blueprint* → selecione o repositório.
2. Preencha as variáveis marcadas `sync: false` (`STAFF_SEED_PASSWORD`, `PIX_CHAVE`).
3. Aplique. As migrations rodam no boot do serviço.

Se preferir manual: *New → Web Service* → build `npm ci && npm run build`, start `npm start`,
health check `/healthz`, e `DATABASE_URL` vindo do Postgres criado no Render (use a *Internal URL*).

### Opção C — VPS com Docker

```bash
git clone https://github.com/deividjmoura/pier-509.git /srv/pier509
cd /srv/pier509

cat > .env.prod <<'EOF'
NODE_ENV=production
DATABASE_URL=postgres://postgres:senha@127.0.0.1:5432/pier509
PORT=3000
STAFF_SEED_PASSWORD=coloque-uma-senha-de-12-ou-mais
PIX_CHAVE=sua-chave
PIX_NOME=PIER 509
PIX_CIDADE=ITAJAI
APP_TIMEZONE=America/Sao_Paulo
EOF

docker build -t pier509:latest .
docker run -d --name pier509 --restart unless-stopped \
  --env-file .env.prod -p 127.0.0.1:3000:3000 pier509:latest
docker logs -f pier509        # primeira subida: migrations + staff inicial
curl -s localhost:3000/healthz
```

Atualizar depois: `git pull && docker build -t pier509:latest . && docker rm -f pier509 && docker run ...`
(as migrations pendentes rodam no boot).

### Opção D — VPS sem Docker (pm2 ou systemd + Nginx)

```bash
cd /srv/pier509
npm ci
npm run build
npm ci --omit=dev        # deixa só o necessário em runtime
pm2 start server.js --name pier509 --update-env
pm2 save && pm2 startup  # sobe no boot da máquina
```

Alternativa com systemd (`/etc/systemd/system/pier509.service`):

```ini
[Unit]
Description=Pier 509
After=network.target postgresql.service

[Service]
WorkingDirectory=/srv/pier509
EnvironmentFile=/srv/pier509/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now pier509
```

Nginx na frente (HTTPS com Certbot):

```nginx
server {
  listen 443 ssl;
  server_name pier509.com.br;

  # SSE (cozinha/bar/caixa ao vivo) precisa de buffering desligado
  location /api/events {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_read_timeout 1h;
  }

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

server {
  listen 80;
  server_name pier509.com.br;
  return 301 https://$host$request_uri;
}
```

```bash
sudo certbot --nginx -d pier509.com.br
```

> Dois detalhes que quebram a operação se esquecidos: sem `X-Forwarded-Proto: https` o cookie de
> sessão não é emitido como `Secure` em produção, e sem `proxy_buffering off` o SSE da cozinha
> "congela" (a fila não atualiza sozinha).

### Domínio e HTTPS

1. No DNS, aponte `pier509.com.br` (e `www`, se quiser) para o host da plataforma.
2. Ative o certificado (automático em Railway/Render; Certbot no VPS).
3. Só depois de HTTPS funcionando, **imprima os QR das mesas**.
4. Cookies de sessão são `HttpOnly`, `SameSite=Lax` e `Secure` em produção — o que **exige** HTTPS.

---

## Variáveis de ambiente

| Variável | Padrão | Para que serve |
|---|---|---|
| `DATABASE_URL` | — (obrigatória) | Conexão Postgres; `sslmode` é normalizado sozinho |
| `NODE_ENV` | `development` | Em `production`: cookie `Secure`, erros de 500 sem detalhe, senha de bootstrap ≥ 12 |
| `PORT` | `3000` | Porta do servidor (a plataforma costuma injetar) |
| `STAFF_SEED_PASSWORD` | — | Senha inicial de `admin`/`cozinha`/`bar`/`caixa` (≥ 12 em produção) |
| `PIX_CHAVE` | vazio | CPF, CNPJ, e-mail, telefone ou EVP do recebimento |
| `PIX_NOME` | `LANCHONETE` | Nome do recebedor no BR Code (sem acento, ≤ 25 caracteres) |
| `PIX_CIDADE` | `SAO PAULO` | Cidade do recebedor |
| `APP_TIMEZONE` | `America/Sao_Paulo` | Fuso do dashboard e relatórios |
| `DATABASE_SSL` | auto | `true` força SSL quando a URL não traz `sslmode` |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | `true` | `false` só para provedor com CA que o Node não confia |
| `CSRF_ALLOWED_ORIGINS` | vazio | Origens extras liberadas (ex.: front em outro domínio) |
| `MAX_BODY_BYTES` | `131072` | Limite de corpo das rotas normais (upload de foto tem limite próprio) |
| `FOTO_MAX_EDGE` / `FOTO_WEBP_QUALITY` | `960` / `82` | Tamanho e qualidade das fotos otimizadas |
| `FOTO_MAX_BODY_BYTES` / `FOTO_MAX_INPUT_BYTES` / `FOTO_MAX_OUTPUT_BYTES` | `8 MB` / `6 MB` / `320 KB` | Limites de upload e do WebP gerado |
| `PG_POOL_MAX` / `PG_CONNECT_TIMEOUT_MS` | `10` / `10000` | Pool de conexões |
| `CARDAPIO_CACHE_TTL_MS` | `30000` | Cache do cardápio público |

---

## Checklist pós-deploy

```bash
BASE=https://pier509.com.br

curl -s $BASE/healthz                 # {"ok":true,"banco":"ok",...}
curl -s -o /dev/null -w "%{http_code}\n" $BASE/          # 200 (app servido de dist/)
curl -s -o /dev/null -w "%{http_code}\n" $BASE/login     # 302 → /#/login
```

No navegador, na ordem:

- [ ] `/` abre com o selo, sem tela branca, e o **tema claro/escuro** alterna e sobrevive a um F5.
- [ ] `/login` entra com `admin` e cai no *Comando*.
- [ ] *Comando → Mesas* mostra os QR e o link de cada mesa.
- [ ] `/mesa/<token>` pede o nome, mostra o cardápio e **envia um pedido**.
- [ ] `/cozinha` e `/bar` mostram o pedido novo **ao vivo** (sem recarregar) e o som/voz toca.
- [ ] `/garcom/<token>` entrega o item; `/caixa` mostra a comanda, o PIX e fecha a conta.
- [ ] Imprimir cupom/relatório abre a janela de impressão sem erro.
- [ ] No celular real: ler o QR da mesa e fazer o pedido no 4G (não só no Wi-Fi da loja).

> O rate-limit é em memória: mantenha **uma instância** da aplicação. Se um dia escalar para várias,
> mova o limitador para Redis (ou deixe no proxy/CDN).

---

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `502` no primeiro deploy | build falhou ou o processo morreu no boot | veja os logs; confirme `npm run build` local e `DATABASE_URL` |
| Página "interface não compilada" (503) | `dist/` ausente no deploy | rode `npm run build` (ou use o `dist/` que está no repositório) |
| `503 Bootstrap de staff não configurado` | `STAFF_SEED_PASSWORD` ausente ou < 12 caracteres | defina a variável e reinicie; depois `npm run db:reset-senha` |
| `❌ DATABASE_URL não definida` | variável não chegou ao processo | confira *Variables* e se o serviço reiniciou |
| `self-signed certificate in certificate chain` | provedor com CA própria | `DATABASE_SSL_REJECT_UNAUTHORIZED=false` |
| Login "volta" para `/login` sempre | cookie não está sendo aceito (sem HTTPS ou domínio diferente) | use o mesmo domínio do app; confirme HTTPS e ausência de proxy que reescreva cookies |
| `429 Muitas tentativas` | rate-limit de login após erros seguidos | espere ~1 minuto ou reinicie o serviço |
| Cozinha não atualiza sozinha | SSE bloqueado por proxy (buffering) | desligue `proxy_buffering` no caminho `/api/events` |
| Upload de foto falha com 400 | arquivo grande/formato | limite de 6 MB de entrada; use JPG/PNG/WebP |
| `❌ A porta 3000 já está em uso` | outro processo na mesma porta | `PORT=3001 npm start` ou finalize o processo antigo |

---

## Rotina de manutenção

- **Deploy de atualização**: `git push` na `main` (Railway/Render fazem o resto) ou
  `git pull && npm ci && npm run build && pm2 restart pier509`. As migrations pendentes rodam no boot.
- **Voltar atrás**: plataformas permitem *Rollback* para o deploy anterior. Se a versão anterior
  exigir schema diferente, restaure o `pg_dump` feito antes.
- **Backup**: `pg_dump -Fc` semanal + backup automático do provedor. Guarde fora do servidor.
- **Senhas**: `STAFF_SEED_PASSWORD` só é usada no bootstrap. Para trocar depois:
  `STAFF_SEED_PASSWORD='nova' npm run db:reset-senha`.
- **Limpeza de dados antigos**: *Comando → Funções* tem purga de pedidos/sessões por período.
- **Logs**: `curl /healthz` para monitor externo; logs do processo para o resto. O servidor responde
  `SIGTERM` fechando conexões e pool com calma (o deploy não deixa requisição pendurada).
