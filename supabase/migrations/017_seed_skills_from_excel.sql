-- Poblar operario_habilidades desde MATRIZ DE HABILIDADES FR.xlsx
-- Ejecutar DESPUES de migration 016 (nuevo enum con 11 skills)
-- Logica: si sabe usar al menos 1 robot → ROBOTS, al menos 1 prelim → PRELIMINARES, etc.
-- Pespunte se mantiene detallado por maquina.

-- Limpiar datos existentes
DELETE FROM operario_habilidades;

-- ALMA ZULEMA CISNEROS FERNANDEZ
INSERT INTO operario_habilidades (operario_id, habilidad)
SELECT op.id, s.habilidad
FROM operarios op
CROSS JOIN (VALUES ('PRELIMINARES'::skill_type), ('MAQ_COMPLEMENTARIAS'::skill_type)) AS s(habilidad)
WHERE UPPER(op.nombre) = 'ALMA ZULEMA CISNEROS FERNANDEZ'
ON CONFLICT (operario_id, habilidad) DO NOTHING;

-- SUMIKI JUDITH RODRIGUEZ NOLASCO
INSERT INTO operario_habilidades (operario_id, habilidad)
SELECT op.id, s.habilidad
FROM operarios op
CROSS JOIN (VALUES ('PRELIMINARES'::skill_type)) AS s(habilidad)
WHERE UPPER(op.nombre) = 'SUMIKI JUDITH RODRIGUEZ NOLASCO'
ON CONFLICT (operario_id, habilidad) DO NOTHING;

-- EVELIN SARAI CORNEJO HERRERA
INSERT INTO operario_habilidades (operario_id, habilidad)
SELECT op.id, s.habilidad
FROM operarios op
CROSS JOIN (VALUES ('PRELIMINARES'::skill_type), ('MAQ_COMPLEMENTARIAS'::skill_type)) AS s(habilidad)
WHERE UPPER(op.nombre) = 'EVELIN SARAI CORNEJO HERRERA'
ON CONFLICT (operario_id, habilidad) DO NOTHING;

-- CHAVARIN ARCE IRMA LIZETH CHAVARIN ARCE
INSERT INTO operario_habilidades (operario_id, habilidad)
SELECT op.id, s.habilidad
FROM operarios op
CROSS JOIN (VALUES ('PRELIMINARES'::skill_type), ('MAQ_COMPLEMENTARIAS'::skill_type)) AS s(habilidad)
WHERE UPPER(op.nombre) = 'CHAVARIN ARCE IRMA LIZETH CHAVARIN ARCE'
ON CONFLICT (operario_id, habilidad) DO NOTHING;

-- CARRILLO BARAJAS AURORA JAQUELIN
INSERT INTO operario_habilidades (operario_id, habilidad)
SELECT op.id, s.habilidad
FROM operarios op
CROSS JOIN (VALUES ('PRELIMINARES'::skill_type), ('ROBOTS'::skill_type), ('MAQ_COMPLEMENTARIAS'::skill_type)) AS s(habilidad)
WHERE UPPER(op.nombre) = 'CARRILLO BARAJAS AURORA JAQUELIN'
ON CONFLICT (operario_id, habilidad) DO NOTHING;

-- SANDOVAL MARTINEZ PEDRO SAUL
INSERT INTO operario_habilidades (operario_id, habilidad)
SELECT op.id, s.habilidad
FROM operarios op
CROSS JOIN (VALUES ('PRELIMINARES'::skill_type), ('ROBOTS'::skill_type)) AS s(habilidad)
WHERE UPPER(op.nombre) = 'SANDOVAL MARTINEZ PEDRO SAUL'
ON CONFLICT (operario_id, habilidad) DO NOTHING;

-- ANGUIANO DE LEON JUANA ARACELI
INSERT INTO operario_habilidades (operario_id, habilidad)
SELECT op.id, s.habilidad
FROM operarios op
CROSS JOIN (VALUES ('PRELIMINARES'::skill_type), ('PLANA_RECTA'::skill_type)) AS s(habilidad)
WHERE UPPER(op.nombre) = 'ANGUIANO DE LEON JUANA ARACELI'
ON CONFLICT (operario_id, habilidad) DO NOTHING;

-- CASTAÑEDA CERVANTES CARLOS ANTONIO
INSERT INTO operario_habilidades (operario_id, habilidad)
SELECT op.id, s.habilidad
FROM operarios op
CROSS JOIN (VALUES ('PRELIMINARES'::skill_type), ('ROBOTS'::skill_type), ('MAQ_COMPLEMENTARIAS'::skill_type)) AS s(habilidad)
WHERE UPPER(op.nombre) = 'CASTAÑEDA CERVANTES CARLOS ANTONIO'
ON CONFLICT (operario_id, habilidad) DO NOTHING;

-- BARAJAS VALLADOLID BETSY ELIZABETH
INSERT INTO operario_habilidades (operario_id, habilidad)
SELECT op.id, s.habilidad
FROM operarios op
CROSS JOIN (VALUES ('PRELIMINARES'::skill_type), ('MAQ_COMPLEMENTARIAS'::skill_type)) AS s(habilidad)
WHERE UPPER(op.nombre) = 'BARAJAS VALLADOLID BETSY ELIZABETH'
ON CONFLICT (operario_id, habilidad) DO NOTHING;

-- VAZQUEZ GONZALEZ LILIAN ALEXIAN
INSERT INTO operario_habilidades (operario_id, habilidad)
SELECT op.id, s.habilidad
FROM operarios op
CROSS JOIN (VALUES ('PRELIMINARES'::skill_type), ('ROBOTS'::skill_type), ('MAQ_COMPLEMENTARIAS'::skill_type)) AS s(habilidad)
WHERE UPPER(op.nombre) = 'VAZQUEZ GONZALEZ LILIAN ALEXIAN'
ON CONFLICT (operario_id, habilidad) DO NOTHING;

-- MORALES CHAVARIN KEVIN ALEJANDRO
INSERT INTO operario_habilidades (operario_id, habilidad)
SELECT op.id, s.habilidad
FROM operarios op
CROSS JOIN (VALUES ('PRELIMINARES'::skill_type), ('ROBOTS'::skill_type), ('MAQ_COMPLEMENTARIAS'::skill_type)) AS s(habilidad)
WHERE UPPER(op.nombre) = 'MORALES CHAVARIN KEVIN ALEJANDRO'
ON CONFLICT (operario_id, habilidad) DO NOTHING;

-- ACEVES ROBLES ALVARO
INSERT INTO operario_habilidades (operario_id, habilidad)
SELECT op.id, s.habilidad
FROM operarios op
CROSS JOIN (VALUES ('PRELIMINARES'::skill_type), ('MAQ_COMPLEMENTARIAS'::skill_type), ('ZIGZAG'::skill_type), ('PLANA_RECTA'::skill_type), ('DOS_AGUJAS'::skill_type), ('POSTE_CONV'::skill_type), ('RIBETE'::skill_type)) AS s(habilidad)
WHERE UPPER(op.nombre) = 'ACEVES ROBLES ALVARO'
ON CONFLICT (operario_id, habilidad) DO NOTHING;

-- ARCOS GODINEZ ANA LIZETTE
INSERT INTO operario_habilidades (operario_id, habilidad)
SELECT op.id, s.habilidad
FROM operarios op
CROSS JOIN (VALUES ('PRELIMINARES'::skill_type), ('ROBOTS'::skill_type), ('MAQ_COMPLEMENTARIAS'::skill_type)) AS s(habilidad)
WHERE UPPER(op.nombre) = 'ARCOS GODINEZ ANA LIZETTE'
ON CONFLICT (operario_id, habilidad) DO NOTHING;

-- ALANIZ GONZALEZ FABIOLA
INSERT INTO operario_habilidades (operario_id, habilidad)
SELECT op.id, s.habilidad
FROM operarios op
CROSS JOIN (VALUES ('PRELIMINARES'::skill_type), ('ROBOTS'::skill_type), ('MAQ_COMPLEMENTARIAS'::skill_type), ('ZIGZAG'::skill_type), ('PLANA_RECTA'::skill_type), ('DOS_AGUJAS'::skill_type), ('POSTE_CONV'::skill_type), ('RIBETE'::skill_type), ('CODO'::skill_type)) AS s(habilidad)
WHERE UPPER(op.nombre) = 'ALANIZ GONZALEZ FABIOLA'
ON CONFLICT (operario_id, habilidad) DO NOTHING;

-- CERVANTES RUIZ MARTHA LETICIA
INSERT INTO operario_habilidades (operario_id, habilidad)
SELECT op.id, s.habilidad
FROM operarios op
CROSS JOIN (VALUES ('PRELIMINARES'::skill_type), ('MAQ_COMPLEMENTARIAS'::skill_type)) AS s(habilidad)
WHERE UPPER(op.nombre) = 'CERVANTES RUIZ MARTHA LETICIA'
ON CONFLICT (operario_id, habilidad) DO NOTHING;

-- CHAVEZ CASTRO HUGO
INSERT INTO operario_habilidades (operario_id, habilidad)
SELECT op.id, s.habilidad
FROM operarios op
CROSS JOIN (VALUES ('PRELIMINARES'::skill_type), ('ZIGZAG'::skill_type), ('PLANA_RECTA'::skill_type), ('POSTE_CONV'::skill_type)) AS s(habilidad)
WHERE UPPER(op.nombre) = 'CHAVEZ CASTRO HUGO'
ON CONFLICT (operario_id, habilidad) DO NOTHING;

-- ESQUIVEL VALENZUELA GUADALUPE NATALY
INSERT INTO operario_habilidades (operario_id, habilidad)
SELECT op.id, s.habilidad
FROM operarios op
CROSS JOIN (VALUES ('PRELIMINARES'::skill_type), ('ROBOTS'::skill_type), ('MAQ_COMPLEMENTARIAS'::skill_type)) AS s(habilidad)
WHERE UPPER(op.nombre) = 'ESQUIVEL VALENZUELA GUADALUPE NATALY'
ON CONFLICT (operario_id, habilidad) DO NOTHING;

-- MORA LUCAS AMERICO ADALID
INSERT INTO operario_habilidades (operario_id, habilidad)
SELECT op.id, s.habilidad
FROM operarios op
CROSS JOIN (VALUES ('PRELIMINARES'::skill_type), ('ROBOTS'::skill_type), ('MAQ_COMPLEMENTARIAS'::skill_type), ('PLANA_RECTA'::skill_type)) AS s(habilidad)
WHERE UPPER(op.nombre) = 'MORA LUCAS AMERICO ADALID'
ON CONFLICT (operario_id, habilidad) DO NOTHING;

-- IBARRA HUERTA VICTOR HUGO
INSERT INTO operario_habilidades (operario_id, habilidad)
SELECT op.id, s.habilidad
FROM operarios op
CROSS JOIN (VALUES ('PRELIMINARES'::skill_type), ('ROBOTS'::skill_type), ('MAQ_COMPLEMENTARIAS'::skill_type), ('ZIGZAG'::skill_type), ('PLANA_RECTA'::skill_type), ('DOS_AGUJAS'::skill_type), ('POSTE_CONV'::skill_type), ('RIBETE'::skill_type), ('CODO'::skill_type)) AS s(habilidad)
WHERE UPPER(op.nombre) = 'IBARRA HUERTA VICTOR HUGO'
ON CONFLICT (operario_id, habilidad) DO NOTHING;
