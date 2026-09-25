-- 0002_ingredientes_ponto_carne.sql
-- Cobre duas regras de exibição/validação que existiam em customization no
-- data/db.json (MVP) e não tinham equivalente no schema 0001:
--
--   1) meatPoint: se o produto pergunta ponto da carne
--   2) removals:  lista fechada de ingredientes que o produto aceita remover
--
-- Sem isso o servidor não tem como validar removals vindo do cliente
-- (ver seção 6 do plano: "nunca confiar em valor vindo do cliente").

ALTER TABLE produtos
  ADD COLUMN pede_ponto_carne BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- produtos_ingredientes_removiveis
-- Lista fechada, por produto, de ingredientes que podem ser removidos.
-- itens_pedido_remocoes (0001) continua sendo o registro do que foi
-- efetivamente removido em cada pedido; esta tabela é a whitelist.
-- ---------------------------------------------------------------------------
CREATE TABLE produtos_ingredientes_removiveis (
  produto_id   INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  ingrediente  TEXT NOT NULL,
  PRIMARY KEY (produto_id, ingrediente)
);
