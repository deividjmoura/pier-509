-- 0014_item_entregue.sql
-- Permite entrega parcial: status do item inclui "entregue".
-- Garçom entrega o que já está pronto (ex.: bebida) sem esperar a cozinha.

ALTER TABLE itens_pedido DROP CONSTRAINT IF EXISTS itens_pedido_status_check;
ALTER TABLE itens_pedido
  ADD CONSTRAINT itens_pedido_status_check
  CHECK (status IN ('recebido', 'em_producao', 'concluido', 'entregue'));

COMMENT ON COLUMN itens_pedido.status IS
  'recebido → em_producao → concluido (pronto no setor) → entregue (garçom levou à mesa)';
