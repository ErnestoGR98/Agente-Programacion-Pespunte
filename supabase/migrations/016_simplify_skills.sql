-- Simplify operator skills: 20 granular → 11 in 5 categories
-- Migrate existing data before changing enum

-- Step 1: Create temp table with migrated data
CREATE TEMP TABLE _migrated_skills AS
SELECT DISTINCT operario_id, 'PRELIMINARES' AS habilidad
FROM operario_habilidades
WHERE habilidad IN ('ARMADO_PALETS','PISTOLA','HEBILLAS','DESHEBRADOS','ALIMENTAR_LINEA',
                    'MAQ_PINTURA','REMACH_NEUMATICA','REMACH_MECANICA','PERFORADORA_JACK')
UNION
SELECT DISTINCT operario_id, 'ROBOTS'
FROM operario_habilidades
WHERE habilidad IN ('ROBOT_3020','ROBOT_CHACHE','ROBOT_DOBLE_ACCION','ROBOT_6040','ROBOT_2AG')
UNION
SELECT operario_id, habilidad::text
FROM operario_habilidades
WHERE habilidad IN ('ZIGZAG','PLANA_RECTA','DOS_AGUJAS','POSTE_CONV','RIBETE','CODO');

-- Step 2: Drop old data and enum
DELETE FROM operario_habilidades;
ALTER TABLE operario_habilidades ALTER COLUMN habilidad TYPE text;
DROP TYPE IF EXISTS skill_type;

-- Step 3: Create new enum (11 skills, 5 categories)
CREATE TYPE skill_type AS ENUM (
  'PRELIMINARES', 'ROBOTS', 'MAQ_COMPLEMENTARIAS',
  'ZIGZAG', 'PLANA_RECTA', 'DOS_AGUJAS', 'POSTE_CONV', 'RIBETE', 'CODO',
  'MAQUILA', 'GENERAL'
);

-- Step 4: Convert column back to enum
ALTER TABLE operario_habilidades ALTER COLUMN habilidad TYPE skill_type USING habilidad::skill_type;

-- Step 5: Re-insert migrated data
INSERT INTO operario_habilidades (operario_id, habilidad)
SELECT operario_id, habilidad::skill_type FROM _migrated_skills
ON CONFLICT (operario_id, habilidad) DO NOTHING;

DROP TABLE _migrated_skills;
