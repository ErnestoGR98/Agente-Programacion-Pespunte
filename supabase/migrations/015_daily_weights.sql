-- Add daily optimizer weights as configurable parameters
INSERT INTO parametros_optimizacion (nombre, valor) VALUES
  ('w_diario_tardiness', 100000),
  ('w_diario_uniformity', 5000),
  ('w_diario_hc_overflow', 5000),
  ('w_diario_idle', 500),
  ('w_diario_balance', 1)
ON CONFLICT DO NOTHING;
