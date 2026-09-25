-- Staff com papéis + sessões persistentes (sobrevivem a deploy/restart).

CREATE TABLE IF NOT EXISTS staff (
  id            SERIAL PRIMARY KEY,
  nome          TEXT NOT NULL,
  login         TEXT NOT NULL UNIQUE,
  senha_hash    TEXT NOT NULL,
  papel         TEXT NOT NULL CHECK (papel IN ('admin', 'cozinha', 'caixa')),
  ativo         BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_login ON staff (login);
CREATE INDEX IF NOT EXISTS idx_staff_ativo ON staff (ativo);

CREATE TABLE IF NOT EXISTS staff_sessoes (
  token       TEXT PRIMARY KEY,
  staff_id    INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  criada_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_em   TIMESTAMPTZ NOT NULL,
  ultimo_uso  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_sessoes_staff ON staff_sessoes (staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_sessoes_expira ON staff_sessoes (expira_em);
