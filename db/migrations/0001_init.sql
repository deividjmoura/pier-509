-- 0001_init.sql
-- Schema inicial: mesas, cardápio, sessões de mesa, pedidos e itens.
-- Ver "Plano — Lanchonete QR (PostgreSQL)" seção 2 para o racional de cada tabela.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- necessário para gen_random_uuid()

-- ---------------------------------------------------------------------------
-- mesas
-- ---------------------------------------------------------------------------
CREATE TABLE mesas (
  id       SERIAL PRIMARY KEY,
  numero   INTEGER NOT NULL UNIQUE,
  token    UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  status   TEXT NOT NULL DEFAULT 'livre' CHECK (status IN ('livre', 'ocupada'))
);

-- ---------------------------------------------------------------------------
-- categorias
-- ---------------------------------------------------------------------------
CREATE TABLE categorias (
  id     SERIAL PRIMARY KEY,
  nome   TEXT NOT NULL,
  ordem  INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- produtos
-- ---------------------------------------------------------------------------
CREATE TABLE produtos (
  id            SERIAL PRIMARY KEY,
  categoria_id  INTEGER NOT NULL REFERENCES categorias(id) ON DELETE RESTRICT,
  nome          TEXT NOT NULL,
  descricao     TEXT,
  preco         NUMERIC(10,2) NOT NULL CHECK (preco >= 0),
  foto_url      TEXT,
  disponivel    BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_produtos_categoria ON produtos(categoria_id);

-- ---------------------------------------------------------------------------
-- adicionais (vinculados a um produto específico; um adicional reaproveitado
-- em vários produtos = uma linha por produto)
-- ---------------------------------------------------------------------------
CREATE TABLE adicionais (
  id          SERIAL PRIMARY KEY,
  produto_id  INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  preco       NUMERIC(10,2) NOT NULL CHECK (preco >= 0)
);

CREATE INDEX idx_adicionais_produto ON adicionais(produto_id);

-- ---------------------------------------------------------------------------
-- mesa_sessoes ("comanda" da mesa: abre no 1º pedido, fecha no caixa)
-- ---------------------------------------------------------------------------
CREATE TABLE mesa_sessoes (
  id               SERIAL PRIMARY KEY,
  mesa_id          INTEGER NOT NULL REFERENCES mesas(id) ON DELETE RESTRICT,
  aberta_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  fechada_em       TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'fechada')),
  forma_pagamento  TEXT,
  valor_total      NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (valor_total >= 0)
);

CREATE INDEX idx_mesa_sessoes_mesa ON mesa_sessoes(mesa_id);

-- Só pode existir 1 sessão ABERTA por mesa por vez.
CREATE UNIQUE INDEX uq_mesa_sessao_aberta ON mesa_sessoes(mesa_id) WHERE status = 'aberta';

-- ---------------------------------------------------------------------------
-- pedidos
-- ---------------------------------------------------------------------------
CREATE TABLE pedidos (
  id                 SERIAL PRIMARY KEY,
  sessao_id          INTEGER NOT NULL REFERENCES mesa_sessoes(id) ON DELETE RESTRICT,
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
  status             TEXT NOT NULL DEFAULT 'recebido'
                       CHECK (status IN ('recebido', 'em_producao', 'concluido', 'entregue')),
  observacao_geral   TEXT
);

CREATE INDEX idx_pedidos_sessao ON pedidos(sessao_id);
CREATE INDEX idx_pedidos_status ON pedidos(status);

-- ---------------------------------------------------------------------------
-- itens_pedido (preco_unitario é SNAPSHOT — nunca fazer JOIN com produtos.preco
-- para exibir valor de pedidos já feitos, ver seção 2 do plano)
-- ---------------------------------------------------------------------------
CREATE TABLE itens_pedido (
  id               SERIAL PRIMARY KEY,
  pedido_id        INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id       INTEGER NOT NULL REFERENCES produtos(id) ON DELETE RESTRICT,
  quantidade       INTEGER NOT NULL CHECK (quantidade > 0),
  preco_unitario   NUMERIC(10,2) NOT NULL CHECK (preco_unitario >= 0),
  ponto_carne      TEXT CHECK (ponto_carne IS NULL OR ponto_carne IN ('MAL_PASSADO', 'AO_PONTO', 'BEM_PASSADO')),
  observacao       TEXT
);

CREATE INDEX idx_itens_pedido_pedido ON itens_pedido(pedido_id);
CREATE INDEX idx_itens_pedido_produto ON itens_pedido(produto_id);

-- ---------------------------------------------------------------------------
-- itens_pedido_adicionais (junção; preco_unitario também é snapshot)
-- ---------------------------------------------------------------------------
CREATE TABLE itens_pedido_adicionais (
  item_pedido_id  INTEGER NOT NULL REFERENCES itens_pedido(id) ON DELETE CASCADE,
  adicional_id    INTEGER NOT NULL REFERENCES adicionais(id) ON DELETE RESTRICT,
  preco_unitario  NUMERIC(10,2) NOT NULL CHECK (preco_unitario >= 0),
  PRIMARY KEY (item_pedido_id, adicional_id)
);

-- ---------------------------------------------------------------------------
-- itens_pedido_remocoes (ingredientes removidos; sem custo, só registro)
-- ---------------------------------------------------------------------------
CREATE TABLE itens_pedido_remocoes (
  item_pedido_id  INTEGER NOT NULL REFERENCES itens_pedido(id) ON DELETE CASCADE,
  ingrediente     TEXT NOT NULL,
  PRIMARY KEY (item_pedido_id, ingrediente)
);
