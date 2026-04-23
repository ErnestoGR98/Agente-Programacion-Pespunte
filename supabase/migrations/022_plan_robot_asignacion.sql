-- Asignacion real de robots a operaciones ROBOT de un plan semanal.
-- Una fila por cada (plan, modelo, fraccion, robot). El porcentaje indica
-- que fraccion de las horas robot de esa operacion van a ese robot.
CREATE TABLE IF NOT EXISTS plan_robot_asignacion (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id      UUID NOT NULL REFERENCES planes_semanales(id) ON DELETE CASCADE,
  modelo_num   TEXT NOT NULL,
  fraccion     INTEGER NOT NULL,
  robot_id     UUID NOT NULL REFERENCES robots(id) ON DELETE CASCADE,
  porcentaje   NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (porcentaje >= 0 AND porcentaje <= 100),
  UNIQUE (plan_id, modelo_num, fraccion, robot_id)
);

CREATE INDEX IF NOT EXISTS idx_plan_robot_asignacion_plan
  ON plan_robot_asignacion(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_robot_asignacion_modelo
  ON plan_robot_asignacion(plan_id, modelo_num, fraccion);

ALTER TABLE plan_robot_asignacion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plan_robot_asignacion_shared" ON plan_robot_asignacion;
CREATE POLICY "plan_robot_asignacion_shared" ON plan_robot_asignacion
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
