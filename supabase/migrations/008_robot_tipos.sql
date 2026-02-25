-- Migration 008: Robot tipos junction table (multi-tipo support)
-- A robot can have multiple types simultaneously (e.g., 3020 + DOBLE_ACCION)

-- 1. Create junction table
CREATE TABLE IF NOT EXISTS robot_tipos (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  robot_id  UUID NOT NULL REFERENCES robots(id) ON DELETE CASCADE,
  tipo      TEXT NOT NULL,
  UNIQUE (robot_id, tipo)
);

-- 2. Migrate existing data from robots.tipo column
INSERT INTO robot_tipos (robot_id, tipo)
SELECT id, tipo FROM robots WHERE tipo IS NOT NULL
ON CONFLICT DO NOTHING;

-- 3. Drop the old single-value column
ALTER TABLE robots DROP COLUMN IF EXISTS tipo;

-- 4. Enable RLS (match robots table policy)
ALTER TABLE robot_tipos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to robot_tipos" ON robot_tipos
  FOR ALL USING (true) WITH CHECK (true);
