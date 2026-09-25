-- Cliente informa que já pagou via PIX (confirmação visual no caixa)
ALTER TABLE mesa_sessoes
  ADD COLUMN IF NOT EXISTS pix_informado_em TIMESTAMPTZ;

COMMENT ON COLUMN mesa_sessoes.pix_informado_em IS 'Quando o cliente tocou em "Já paguei no PIX" na mesa';
