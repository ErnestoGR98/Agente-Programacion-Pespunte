-- 004_maquila_distribution.sql
-- Migra asignaciones_maquila de "una maquila por fraccion" a
-- "multiples maquilas por item con volumen y fracciones".

-- 1. Drop old unique constraint (fraccion-level)
ALTER TABLE asignaciones_maquila
  DROP CONSTRAINT IF EXISTS asignaciones_maquila_pedido_item_id_fraccion_key;

-- 2. Drop old columns
ALTER TABLE asignaciones_maquila
  DROP COLUMN IF EXISTS fraccion,
  DROP COLUMN IF EXISTS operacion;

-- 3. Add new columns
ALTER TABLE asignaciones_maquila
  ADD COLUMN IF NOT EXISTS pares INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fracciones INT[] NOT NULL DEFAULT '{}';

-- 4. New unique: one row per maquila per item
ALTER TABLE asignaciones_maquila
  ADD CONSTRAINT asignaciones_maquila_item_maquila_unique
  UNIQUE (pedido_item_id, maquila);
