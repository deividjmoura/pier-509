-- Marca quando o cliente editou o pedido antes da cozinha começar.
ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS editado_em TIMESTAMPTZ;

COMMENT ON COLUMN pedidos.editado_em IS 'Última edição pelo cliente (só enquanto status = recebido)';
