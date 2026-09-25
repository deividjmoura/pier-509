-- Ordem dos produtos dentro da categoria (cardápio admin → mesa)
ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS ordem INTEGER NOT NULL DEFAULT 0;

-- Inicializa ordem por categoria (id crescente)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY categoria_id ORDER BY id) - 1 AS rn
  FROM produtos
)
UPDATE produtos p
   SET ordem = ranked.rn
  FROM ranked
 WHERE p.id = ranked.id;

CREATE INDEX IF NOT EXISTS idx_produtos_categoria_ordem
  ON produtos (categoria_id, ordem);
