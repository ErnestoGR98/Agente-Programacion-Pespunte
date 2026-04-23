-- Orden explicito para filas (modelo+color) dentro de un plan_semanal
ALTER TABLE plan_semanal_items
  ADD COLUMN IF NOT EXISTS orden INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_plan_semanal_items_plan_orden
  ON plan_semanal_items(plan_id, orden);
