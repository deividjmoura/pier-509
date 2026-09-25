-- Nome do cliente na sessão/pedido + garçons identificados por token
-- e assinatura do pedido na entrega (lock otimista).

ALTER TABLE mesa_sessoes
  ADD COLUMN IF NOT EXISTS cliente_nome TEXT;

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS cliente_nome TEXT;

CREATE TABLE IF NOT EXISTS garcons (
  id         SERIAL PRIMARY KEY,
  nome       TEXT NOT NULL,
  token      UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  ativo      BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS garcom_id INTEGER REFERENCES garcons(id) ON DELETE SET NULL;

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS garcom_nome TEXT;

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pedidos_garcom ON pedidos(garcom_id);
CREATE INDEX IF NOT EXISTS idx_garcons_token ON garcons(token);
CREATE INDEX IF NOT EXISTS idx_garcons_ativo ON garcons(ativo);
