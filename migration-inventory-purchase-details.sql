-- Adiciona fornecedor e preco unitario as entradas de estoque existentes.
-- Movimentacoes antigas permanecem sem custo e continuam aparecendo no historico.

ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS fornecedor TEXT,
  ADD COLUMN IF NOT EXISTS preco_unitario NUMERIC(12,2);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_purchase_compare
  ON inventory_movements(product_id, data)
  WHERE tipo = 'entrada' AND preco_unitario IS NOT NULL;

NOTIFY pgrst, 'reload schema';
