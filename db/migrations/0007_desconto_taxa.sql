-- v2.6 — desconto e taxa de serviço no fechamento da conta
ALTER TABLE mesa_sessoes
  ADD COLUMN IF NOT EXISTS desconto NUMERIC(10,2) NOT NULL DEFAULT 0
    CHECK (desconto >= 0),
  ADD COLUMN IF NOT EXISTS taxa_servico NUMERIC(10,2) NOT NULL DEFAULT 0
    CHECK (taxa_servico >= 0),
  ADD COLUMN IF NOT EXISTS valor_cobrado NUMERIC(10,2);

COMMENT ON COLUMN mesa_sessoes.desconto IS 'Desconto em R$ aplicado no fechamento';
COMMENT ON COLUMN mesa_sessoes.taxa_servico IS 'Taxa de serviço em R$ aplicada no fechamento';
COMMENT ON COLUMN mesa_sessoes.valor_cobrado IS 'Valor efetivamente cobrado (valor_total - desconto + taxa_servico)';
