-- 0015_indices_e_status_item.sql
-- Índices para filas de cozinha/bar/garçom e consistência de status de item.

-- Status de item (já usado em produção; garante default e check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'itens_pedido' AND column_name = 'status'
  ) THEN
    ALTER TABLE itens_pedido
      ADD COLUMN status TEXT NOT NULL DEFAULT 'recebido'
      CHECK (status IN ('recebido', 'em_producao', 'concluido', 'entregue'));
  END IF;
END $$;

-- Índices compostos usados pelas filas
CREATE INDEX IF NOT EXISTS idx_itens_pedido_status_pedido
  ON itens_pedido (status, pedido_id);

CREATE INDEX IF NOT EXISTS idx_pedidos_status_criado
  ON pedidos (status, criado_em);

CREATE INDEX IF NOT EXISTS idx_mesa_sessoes_status_mesa
  ON mesa_sessoes (status, mesa_id);

CREATE INDEX IF NOT EXISTS idx_produtos_setor
  ON produtos (COALESCE(setor, 'cozinha'));

-- Acelera getFilaGarcom (itens concluídos aguardando entrega)
CREATE INDEX IF NOT EXISTS idx_itens_pedido_concluido
  ON itens_pedido (pedido_id)
  WHERE COALESCE(status, 'recebido') = 'concluido';
