-- 006_alternativas_imagenes.sql
-- Agrega columna JSONB para URLs de imagen por alternativa de color.
-- Ejemplo: {"NE": "https://...url...", "GC": "https://...url..."}

ALTER TABLE catalogo_modelos
  ADD COLUMN IF NOT EXISTS alternativas_imagenes JSONB DEFAULT '{}'::JSONB;
