-- Matriz global robot × (modelo, fraccion) indicando si el programa esta
-- cargado (TIENE) o hace falta cargarlo (FALTA). Celdas no listadas = no aplica.
CREATE TABLE IF NOT EXISTS robot_programa (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  robot_id   UUID NOT NULL REFERENCES robots(id) ON DELETE CASCADE,
  modelo_num TEXT NOT NULL,
  fraccion   INTEGER NOT NULL,
  estado     TEXT NOT NULL CHECK (estado IN ('TIENE', 'FALTA')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (robot_id, modelo_num, fraccion)
);

CREATE INDEX IF NOT EXISTS idx_robot_programa_modelo
  ON robot_programa(modelo_num, fraccion);
CREATE INDEX IF NOT EXISTS idx_robot_programa_robot
  ON robot_programa(robot_id);

ALTER TABLE robot_programa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "robot_programa_shared" ON robot_programa;
CREATE POLICY "robot_programa_shared" ON robot_programa
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
