-- Agregar fabrica por defecto al catalogo de modelos
ALTER TABLE catalogo_modelos
  ADD COLUMN IF NOT EXISTS fabrica_default TEXT;

-- No FK a fabricas.nombre porque fabricas usa UUID como PK.
-- El campo guarda el nombre de la fabrica (ej: "FABRICA 1") directamente.
-- Esto simplifica queries y es consistente con pedido_items.fabrica.
