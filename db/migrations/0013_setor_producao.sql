-- 0013_setor_producao.sql
-- Divide a produção em dois setores (cozinha/bar) e move o controle de
-- status do nível "pedido inteiro" para o nível "item do pedido", já que
-- um mesmo pedido pode ter itens de cozinha e de bar em ritmos diferentes.

-- ---------------------------------------------------------------------------
-- produtos.setor — cada produto pertence a um setor de produção
-- ---------------------------------------------------------------------------
ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS setor TEXT NOT NULL DEFAULT 'cozinha'
    CHECK (setor IN ('cozinha', 'bar'));

COMMENT ON COLUMN produtos.setor IS
  'Quem produz este item: cozinha (comida) ou bar (bebida)';

-- Backfill best-effort: categorias que claramente são bebida viram 'bar'.
-- Ajuste os nomes abaixo conforme suas categorias reais antes de rodar em produção.
UPDATE produtos p
SET setor = 'bar'
FROM categorias c
WHERE c.id = p.categoria_id
  AND (
    lower(c.nome) LIKE '%bebida%' OR
    lower(c.nome) LIKE '%suco%'   OR
    lower(c.nome) LIKE '%drink%'  OR
    lower(c.nome) LIKE '%cerveja%' OR
    lower(c.nome) LIKE '%chopp%'
  );

-- ---------------------------------------------------------------------------
-- itens_pedido.status — cada item agora tem seu próprio andamento
-- ---------------------------------------------------------------------------
ALTER TABLE itens_pedido
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'recebido'
    CHECK (status IN ('recebido', 'em_producao', 'concluido'));

-- Backfill: item herda o status atual do pedido-pai (entregue conta como concluído
-- no nível do item, o "entregue" continua existindo só no pedido).
UPDATE itens_pedido ip
SET status = CASE p.status
  WHEN 'entregue'  THEN 'concluido'
  WHEN 'concluido' THEN 'concluido'
  WHEN 'em_producao' THEN 'em_producao'
  ELSE 'recebido'
END
FROM pedidos p
WHERE p.id = ip.pedido_id;

CREATE INDEX IF NOT EXISTS idx_itens_pedido_status ON itens_pedido(status);

-- ---------------------------------------------------------------------------
-- staff: novo papel 'bar'
-- ---------------------------------------------------------------------------
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_papel_check;
ALTER TABLE staff ADD CONSTRAINT staff_papel_check
  CHECK (papel IN ('admin', 'cozinha', 'bar', 'caixa'));
