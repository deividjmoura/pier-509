-- pix_avisos existia só como CREATE TABLE IF NOT disparado dentro de handlers de
-- requisição (db/pix-cliente.js / db/caixa.js / db/pedidos.js). Schema versionado é
-- o lugar certo: o runner de migrations já garante idempotência e o gate de release
-- (npm run start:prod) garante a aplicação. Bancos que já têm a tabela não mudam.

CREATE TABLE IF NOT EXISTS pix_avisos (
  id SERIAL PRIMARY KEY,
  sessao_id INT NOT NULL REFERENCES mesa_sessoes(id) ON DELETE CASCADE,
  pedido_id INT REFERENCES pedidos(id) ON DELETE SET NULL,
  valor NUMERIC(12,2) NOT NULL,
  cliente_nome TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmado_em TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pix_avisos_sessao_status
  ON pix_avisos (sessao_id, status);
