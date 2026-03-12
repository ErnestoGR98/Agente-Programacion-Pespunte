-- Remove MAQUILA and GENERAL from skill_type enum
-- These are not operator skills: MAQUILA is external manufacturing,
-- GENERAL was unused (all operations have specific resources)

-- Step 1: Delete any existing MAQUILA/GENERAL skill assignments
DELETE FROM operario_habilidades WHERE habilidad IN ('MAQUILA', 'GENERAL');

-- Step 2: Convert column to text, recreate enum without MAQUILA/GENERAL, convert back
ALTER TABLE operario_habilidades ALTER COLUMN habilidad TYPE text;
DROP TYPE IF EXISTS skill_type;

CREATE TYPE skill_type AS ENUM (
  'PRELIMINARES', 'ROBOTS', 'MAQ_COMPLEMENTARIAS',
  'ZIGZAG', 'PLANA_RECTA', 'DOS_AGUJAS', 'POSTE_CONV', 'RIBETE', 'CODO'
);

ALTER TABLE operario_habilidades ALTER COLUMN habilidad TYPE skill_type USING habilidad::skill_type;
