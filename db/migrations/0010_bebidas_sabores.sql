-- Reorganiza bebidas com sabores/tamanhos como adicionais (Escolher = rádio).
-- Idempotente: só insere se o produto existir e ainda não tiver o adicional.

-- Helper: insert adicional if product exists and flavor missing
-- Refrigerante Lata
INSERT INTO adicionais (produto_id, nome, preco)
SELECT p.id, v.nome, 0
FROM produtos p
JOIN categorias c ON c.id = p.categoria_id
CROSS JOIN (VALUES
  ('Coca-Cola'),
  ('Guaraná'),
  ('Fanta Laranja'),
  ('Fanta Uva'),
  ('Sprite')
) AS v(nome)
WHERE lower(p.nome) = 'refrigerante lata'
  AND NOT EXISTS (
    SELECT 1 FROM adicionais a WHERE a.produto_id = p.id AND lower(a.nome) = lower(v.nome)
  );

-- Refrigerante 600ml
INSERT INTO adicionais (produto_id, nome, preco)
SELECT p.id, v.nome, 0
FROM produtos p
CROSS JOIN (VALUES
  ('Coca-Cola'),
  ('Guaraná'),
  ('Fanta Laranja'),
  ('Fanta Uva'),
  ('Sprite')
) AS v(nome)
WHERE lower(p.nome) = 'refrigerante 600ml'
  AND NOT EXISTS (
    SELECT 1 FROM adicionais a WHERE a.produto_id = p.id AND lower(a.nome) = lower(v.nome)
  );

-- Suco Natural
INSERT INTO adicionais (produto_id, nome, preco)
SELECT p.id, v.nome, 0
FROM produtos p
CROSS JOIN (VALUES
  ('Laranja'),
  ('Limão'),
  ('Maracujá'),
  ('Abacaxi'),
  ('Morango'),
  ('Acerola')
) AS v(nome)
WHERE lower(p.nome) = 'suco natural'
  AND NOT EXISTS (
    SELECT 1 FROM adicionais a WHERE a.produto_id = p.id AND lower(a.nome) = lower(v.nome)
  );

-- Milk Shake
INSERT INTO adicionais (produto_id, nome, preco)
SELECT p.id, v.nome, 0
FROM produtos p
CROSS JOIN (VALUES
  ('Chocolate'),
  ('Morango'),
  ('Baunilha'),
  ('Ovomaltine')
) AS v(nome)
WHERE lower(p.nome) = 'milk shake'
  AND NOT EXISTS (
    SELECT 1 FROM adicionais a WHERE a.produto_id = p.id AND lower(a.nome) = lower(v.nome)
  );

-- Caipirinha de Frutas / Drink sem Álcool
INSERT INTO adicionais (produto_id, nome, preco)
SELECT p.id, v.nome, 0
FROM produtos p
CROSS JOIN (VALUES
  ('Limão'),
  ('Morango'),
  ('Maracujá'),
  ('Kiwi'),
  ('Abacaxi')
) AS v(nome)
WHERE lower(p.nome) IN ('caipirinha de frutas', 'drink sem álcool', 'drink sem alcool')
  AND NOT EXISTS (
    SELECT 1 FROM adicionais a WHERE a.produto_id = p.id AND lower(a.nome) = lower(v.nome)
  );

COMMENT ON TABLE adicionais IS 'Opções de produto (extras de lanche OU sabor/tamanho de bebida — UI usa rádio em bebidas)';
