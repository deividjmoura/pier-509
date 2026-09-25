-- Pagamentos parciais / divisão de conta (v2.7)
CREATE TABLE IF NOT EXISTS sessao_pagamentos (
  id              SERIAL PRIMARY KEY,
  sessao_id       INTEGER NOT NULL REFERENCES mesa_sessoes(id) ON DELETE CASCADE,
  valor           NUMERIC(12, 2) NOT NULL CHECK (valor > 0),
  forma_pagamento TEXT NOT NULL,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessao_pagamentos_sessao
  ON sessao_pagamentos (sessao_id);

COMMENT ON TABLE sessao_pagamentos IS 'Pagamentos parciais da sessão (divisão de conta)';
