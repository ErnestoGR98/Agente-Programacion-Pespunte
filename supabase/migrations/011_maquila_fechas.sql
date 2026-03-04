-- Add salida/entrega timestamps to maquila assignments
ALTER TABLE asignaciones_maquila
  ADD COLUMN IF NOT EXISTS fecha_salida TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fecha_entrega TIMESTAMPTZ;
