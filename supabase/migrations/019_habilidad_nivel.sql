-- 019: Add nivel (proficiency level) to operario_habilidades
-- nivel 1 = puede hacerlo (sin bonus)
-- nivel 2 = normal (bonus bajo)
-- nivel 3 = experto/preferido (bonus alto)

ALTER TABLE operario_habilidades
  ADD COLUMN nivel smallint NOT NULL DEFAULT 2
  CHECK (nivel BETWEEN 1 AND 3);

COMMENT ON COLUMN operario_habilidades.nivel IS
  '1=puede, 2=normal, 3=experto — usado por el solver para priorizar asignaciones';
