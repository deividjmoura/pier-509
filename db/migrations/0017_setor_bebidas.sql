-- 0017_setor_bebidas.sql
-- Corrige o setor dos itens de bebida em bancos já populados.
--
-- Sintoma: a tela do Bar ficava vazia e as bebidas apareciam na Cozinha.
-- Causa: a migração 0013 criou produtos.setor com default 'cozinha' e fez
-- backfill apenas do que já existia. Em instalação nova o seed roda DEPOIS das
-- migrações e inseria os itens sem setor — todos viravam 'cozinha'.
-- (O seed passou a gravar o setor; esta migração conserta o que já foi gravado.)
--
-- Seguro rodar mais de uma vez: só toca linhas ainda em 'cozinha' cuja
-- categoria é claramente de bebida. Se o dono mover um item de volta para
-- cozinha depois disso, nenhuma execução futura desfaz a escolha (a migração
-- só entra uma vez, controlada por schema_migrations).

UPDATE produtos p
SET setor = 'bar'
FROM categorias c
WHERE c.id = p.categoria_id
  AND p.setor = 'cozinha'
  AND translate(lower(c.nome), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') LIKE ANY (ARRAY[
    '%bebida%',
    '%suco%',
    '%drink%',
    '%cerveja%',
    '%chopp%',
    '%chope%',
    '%long neck%',
    '%dose%',
    '%caipirinha%',
    '%caipiroska%',
    '%caipi%',
    '%destilado%',
    '%whisky%',
    '%vodka%',
    '%gin%',
    '%cachaca%',
    '%vinho%',
    '%espumante%',
    '%refrigerante%',
    '%energetico%',
    '%agua%',
    '%bar%'
  ]);
