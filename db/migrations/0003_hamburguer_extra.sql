-- Garante "Hambúrguer extra" nos lanches/combos que ainda não têm.
-- Idempotente: só insere se o produto ainda não tiver um adicional com esse nome.

INSERT INTO adicionais (produto_id, nome, preco)
SELECT p.id, 'Hambúrguer extra 150g', 9.00
FROM produtos p
WHERE p.nome IN ('X-Bacon', 'X-Salada', 'Combo Clássico', 'Combo Bacon')
  AND NOT EXISTS (
    SELECT 1 FROM adicionais a
    WHERE a.produto_id = p.id AND a.nome ILIKE 'Hambúrguer extra%'
  );

INSERT INTO adicionais (produto_id, nome, preco)
SELECT p.id, 'Hambúrguer extra 120g', 8.00
FROM produtos p
WHERE p.nome IN ('Duplo Cheddar', 'Combo Duplo')
  AND NOT EXISTS (
    SELECT 1 FROM adicionais a
    WHERE a.produto_id = p.id AND a.nome ILIKE 'Hambúrguer extra%'
  );
