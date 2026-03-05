-- Migration 012: Add lineas_post parameter for conveyor exclusivity
-- Controls how many models can have active POST operations simultaneously per block.
-- Default = 1 (one conveyor belt). Set to 0 to disable the constraint.

INSERT INTO parametros_optimizacion (nombre, valor) VALUES
  ('lineas_post', 1)
ON CONFLICT (nombre) DO NOTHING;
