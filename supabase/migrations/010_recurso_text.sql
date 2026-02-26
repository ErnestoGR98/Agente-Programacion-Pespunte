-- Migration 010: Change recurso from ENUM to TEXT
-- Allows custom resource types (e.g. DESHEBRADORA_AUTOMATICA from complementary machines)

-- 1. Drop the index that depends on the enum column
DROP INDEX IF EXISTS idx_catalogo_ops_recurso;

-- 2. Convert all tables that use resource_type enum to TEXT
ALTER TABLE catalogo_operaciones
  ALTER COLUMN recurso TYPE TEXT USING recurso::TEXT;

ALTER TABLE capacidades_recurso
  ALTER COLUMN tipo TYPE TEXT USING tipo::TEXT;

ALTER TABLE operario_recursos
  ALTER COLUMN recurso TYPE TEXT USING recurso::TEXT;

-- resultados stores schedule as JSONB, check if recurso column exists
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'resultados' AND column_name = 'recurso'
  ) THEN
    EXECUTE 'ALTER TABLE resultados ALTER COLUMN recurso TYPE TEXT USING recurso::TEXT';
  END IF;
END $$;

-- 3. Recreate the index
CREATE INDEX idx_catalogo_ops_recurso ON catalogo_operaciones(recurso);

-- 4. Drop the old enum type (no longer needed by any table)
DROP TYPE IF EXISTS resource_type;
