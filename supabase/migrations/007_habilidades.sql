-- ============================================================
-- 007: Sistema de habilidades granulares para operarios
-- ============================================================

-- Crear tipo enum para habilidades (20 skills)
CREATE TYPE skill_type AS ENUM (
  -- PRELIMINAR (9)
  'ARMADO_PALETS', 'PISTOLA', 'HEBILLAS', 'DESHEBRADOS', 'ALIMENTAR_LINEA',
  'MAQ_PINTURA', 'REMACH_NEUMATICA', 'REMACH_MECANICA', 'PERFORADORA_JACK',
  -- ROBOT (5)
  'ROBOT_3020', 'ROBOT_CHACHE', 'ROBOT_DOBLE_ACCION', 'ROBOT_6040', 'ROBOT_2AG',
  -- PESPUNTE CONVENCIONAL (6)
  'ZIGZAG', 'PLANA_RECTA', 'DOS_AGUJAS', 'POSTE_CONV', 'RIBETE', 'CODO'
);

-- Tabla de habilidades por operario (reemplaza operario_recursos + operario_robots)
CREATE TABLE operario_habilidades (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operario_id  UUID NOT NULL REFERENCES operarios(id) ON DELETE CASCADE,
  habilidad    skill_type NOT NULL,
  UNIQUE (operario_id, habilidad)
);

-- Agregar tipo a robots (para matching por tipo de robot)
ALTER TABLE robots ADD COLUMN tipo TEXT;

-- Poblar tipo en robots existentes
UPDATE robots SET tipo = '3020'          WHERE nombre LIKE '3020%';
UPDATE robots SET tipo = 'DOBLE_ACCION'  WHERE nombre LIKE '2A-%';
UPDATE robots SET tipo = '6040'          WHERE nombre LIKE '6040%';
UPDATE robots SET tipo = 'CHACHE'        WHERE nombre LIKE 'CHACHE%';
