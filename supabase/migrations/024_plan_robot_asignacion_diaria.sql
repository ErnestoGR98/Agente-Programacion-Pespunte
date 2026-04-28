-- Hace la asignacion de robots diaria (en vez de semanal).
-- Antes: una fila por (plan, modelo, fraccion, robot) — el mismo robot toda la semana.
-- Ahora: una fila por (plan, modelo, fraccion, dia, robot) — robots distintos por dia.

ALTER TABLE plan_robot_asignacion
  ADD COLUMN IF NOT EXISTS dia TEXT NOT NULL DEFAULT 'Lun';

-- Quitar el default — todas las filas nuevas deben especificar dia explicitamente.
ALTER TABLE plan_robot_asignacion
  ALTER COLUMN dia DROP DEFAULT;

-- Reemplazar el UNIQUE para incluir dia.
ALTER TABLE plan_robot_asignacion
  DROP CONSTRAINT IF EXISTS plan_robot_asignacion_plan_id_modelo_num_fraccion_robot_id_key;

ALTER TABLE plan_robot_asignacion
  ADD CONSTRAINT plan_robot_asignacion_unique_per_day
  UNIQUE (plan_id, modelo_num, fraccion, dia, robot_id);

-- Index util para queries por dia.
CREATE INDEX IF NOT EXISTS idx_plan_robot_asignacion_dia
  ON plan_robot_asignacion(plan_id, modelo_num, fraccion, dia);
