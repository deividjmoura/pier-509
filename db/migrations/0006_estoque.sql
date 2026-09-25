-- Controle opcional de estoque por produto.
-- controla_estoque = false → ignora quantidade (comportamento atual).
ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS controla_estoque BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS estoque INTEGER,
  ADD COLUMN IF NOT EXISTS estoque_minimo INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN produtos.controla_estoque IS 'Se true, valida e decrementa estoque a cada pedido';
COMMENT ON COLUMN produtos.estoque IS 'Quantidade atual (só se controla_estoque)';
COMMENT ON COLUMN produtos.estoque_minimo IS 'Alerta no admin quando estoque <= este valor';
