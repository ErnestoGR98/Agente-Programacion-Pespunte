-- 005_modelo_imagen.sql
-- Agrega columna para URL de imagen del modelo.

ALTER TABLE catalogo_modelos
  ADD COLUMN IF NOT EXISTS imagen_url TEXT DEFAULT NULL;

-- Storage bucket (ejecutar en Supabase Dashboard > Storage > New Bucket):
-- Nombre: modelos
-- Public: true
-- Allowed MIME types: image/png, image/jpeg, image/webp
-- Max file size: 2MB
