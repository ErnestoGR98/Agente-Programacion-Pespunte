-- ============================================================
-- Pespunte Agent - Schema Inicial para Supabase (PostgreSQL)
-- Migracion: 001_initial_schema.sql
-- Fecha: 2026-02-20
-- ============================================================

-- ============================================================
-- 1. TIPOS ENUMERADOS
-- ============================================================

CREATE TYPE resource_type AS ENUM (
  'MESA', 'ROBOT', 'PLANA', 'POSTE', 'MAQUILA', 'GENERAL'
);

CREATE TYPE process_type AS ENUM (
  'PRELIMINARES', 'ROBOT', 'POST', 'MAQUILA', 'N/A PRELIMINAR'
);

CREATE TYPE constraint_type AS ENUM (
  'PRIORIDAD', 'MAQUILA', 'RETRASO_MATERIAL', 'FIJAR_DIA',
  'FECHA_LIMITE', 'SECUENCIA', 'AGRUPAR_MODELOS', 'AJUSTE_VOLUMEN',
  'LOTE_MINIMO_CUSTOM', 'ROBOT_NO_DISPONIBLE', 'AUSENCIA_OPERARIO',
  'CAPACIDAD_DIA', 'PRECEDENCIA_OPERACION'
);

CREATE TYPE day_name AS ENUM (
  'Sab', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie'
);

CREATE TYPE robot_estado AS ENUM (
  'ACTIVO', 'FUERA DE SERVICIO'
);

CREATE TYPE robot_area AS ENUM (
  'PESPUNTE', 'AVIOS'
);


-- ============================================================
-- 2. TABLAS DE CONFIGURACION (Master Data)
-- ============================================================

-- Robots fisicos
CREATE TABLE robots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      TEXT NOT NULL UNIQUE,
  estado      robot_estado NOT NULL DEFAULT 'ACTIVO',
  area        robot_area NOT NULL DEFAULT 'PESPUNTE',
  orden       INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Aliases de robots (nombres alternativos en Excel)
CREATE TABLE robot_aliases (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alias     TEXT NOT NULL UNIQUE,
  robot_id  UUID NOT NULL REFERENCES robots(id) ON DELETE CASCADE
);

-- Fabricas
CREATE TABLE fabricas (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre  TEXT NOT NULL UNIQUE,
  orden   INT NOT NULL DEFAULT 0
);

-- Capacidades por tipo de recurso (pares/hora)
CREATE TABLE capacidades_recurso (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo        resource_type NOT NULL UNIQUE,
  pares_hora  INT NOT NULL
);

-- Dias laborales de la semana
CREATE TABLE dias_laborales (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        day_name NOT NULL UNIQUE,
  orden         INT NOT NULL,               -- 0=Sab, 1=Lun, 2=Mar...
  minutos       INT NOT NULL,               -- minutos jornada regular
  plantilla     INT NOT NULL,               -- headcount regular
  minutos_ot    INT NOT NULL DEFAULT 0,     -- minutos overtime
  plantilla_ot  INT NOT NULL DEFAULT 0,     -- headcount overtime
  es_sabado     BOOLEAN NOT NULL DEFAULT FALSE
);

-- Horarios (semana y fin de semana)
CREATE TABLE horarios (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo            TEXT NOT NULL UNIQUE CHECK (tipo IN ('SEMANA', 'FINSEMANA')),
  entrada         TIME NOT NULL,
  salida          TIME NOT NULL,
  comida_inicio   TIME,                     -- NULL si no hay comida
  comida_fin      TIME,
  bloque_min      INT NOT NULL DEFAULT 60
);

-- Pesos del optimizador
CREATE TABLE pesos_priorizacion (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre  TEXT NOT NULL UNIQUE,
  valor   INT NOT NULL
);

-- Parametros del optimizador
CREATE TABLE parametros_optimizacion (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre  TEXT NOT NULL UNIQUE,
  valor   NUMERIC NOT NULL
);


-- ============================================================
-- 3. CATALOGO DE MODELOS Y OPERACIONES
-- ============================================================

-- Modelo (cabecera del catalogo)
CREATE TABLE catalogo_modelos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_num        TEXT NOT NULL UNIQUE,      -- "65413"
  codigo_full       TEXT,                       -- "65413 NE/GC"
  alternativas      TEXT[] DEFAULT '{}',        -- {"NE", "GC"}
  clave_material    TEXT DEFAULT '',
  total_sec_per_pair INT DEFAULT 0,            -- sum de operaciones (derivado)
  num_ops           INT DEFAULT 0,             -- count operaciones (derivado)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Operacion (fraccion del catalogo)
CREATE TABLE catalogo_operaciones (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_id         UUID NOT NULL REFERENCES catalogo_modelos(id) ON DELETE CASCADE,
  fraccion          INT NOT NULL,                -- secuencia (1, 2, 3...)
  operacion         TEXT NOT NULL,               -- nombre "PEGAR FELPA"
  input_o_proceso   process_type NOT NULL,
  etapa             TEXT DEFAULT '',             -- "PRE-ROBOT", "POST-LINEA"
  recurso           resource_type NOT NULL,
  recurso_raw       TEXT DEFAULT '',             -- valor original antes de migracion
  rate              NUMERIC NOT NULL DEFAULT 0,  -- pares/hora
  sec_per_pair      INT NOT NULL DEFAULT 0,      -- 3600/rate
  UNIQUE (modelo_id, fraccion)
);

-- Relacion operacion <-> robots permitidos (many-to-many)
CREATE TABLE catalogo_operacion_robots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operacion_id  UUID NOT NULL REFERENCES catalogo_operaciones(id) ON DELETE CASCADE,
  robot_id      UUID NOT NULL REFERENCES robots(id) ON DELETE CASCADE,
  UNIQUE (operacion_id, robot_id)
);

-- Asignacion modelo <-> fabrica
CREATE TABLE modelo_fabrica (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_id   UUID NOT NULL REFERENCES catalogo_modelos(id) ON DELETE CASCADE,
  fabrica_id  UUID NOT NULL REFERENCES fabricas(id) ON DELETE CASCADE,
  UNIQUE (modelo_id, fabrica_id)
);


-- ============================================================
-- 4. OPERARIOS
-- ============================================================

CREATE TABLE operarios (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      TEXT NOT NULL,
  fabrica_id  UUID REFERENCES fabricas(id),
  eficiencia  NUMERIC NOT NULL DEFAULT 1.0
              CHECK (eficiencia >= 0.5 AND eficiencia <= 1.5),
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recursos habilitados del operario
CREATE TABLE operario_recursos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operario_id  UUID NOT NULL REFERENCES operarios(id) ON DELETE CASCADE,
  recurso      resource_type NOT NULL,
  UNIQUE (operario_id, recurso)
);

-- Robots habilitados del operario
CREATE TABLE operario_robots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operario_id  UUID NOT NULL REFERENCES operarios(id) ON DELETE CASCADE,
  robot_id     UUID NOT NULL REFERENCES robots(id) ON DELETE CASCADE,
  UNIQUE (operario_id, robot_id)
);

-- Dias disponibles del operario
CREATE TABLE operario_dias (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operario_id  UUID NOT NULL REFERENCES operarios(id) ON DELETE CASCADE,
  dia          day_name NOT NULL,
  UNIQUE (operario_id, dia)
);


-- ============================================================
-- 5. PEDIDOS SEMANALES
-- ============================================================

-- Cabecera del pedido (una semana)
CREATE TABLE pedidos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      TEXT NOT NULL UNIQUE,           -- "sem_8_2026"
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Items del pedido
CREATE TABLE pedido_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id       UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  modelo_num      TEXT NOT NULL,               -- referencia al modelo
  color           TEXT NOT NULL DEFAULT '',
  clave_material  TEXT DEFAULT '',
  fabrica         TEXT DEFAULT '',              -- nombre fabrica (denormalizado)
  volumen         INT NOT NULL CHECK (volumen > 0),
  UNIQUE (pedido_id, modelo_num, color)
);


-- ============================================================
-- 6. RESTRICCIONES
-- ============================================================

CREATE TABLE restricciones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  semana      TEXT,                            -- semana asociada (opcional)
  tipo        constraint_type NOT NULL,
  modelo_num  TEXT NOT NULL DEFAULT '*',       -- "*" = todos los modelos
  activa      BOOLEAN NOT NULL DEFAULT TRUE,
  parametros  JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN restricciones.parametros IS
  'Parametros especificos del tipo:
   PRIORIDAD: {"peso": 1|2|3}
   MAQUILA: {"pares_maquila": int}
   RETRASO_MATERIAL: {"disponible_desde": "Mar", "hora_disponible": "10:00"}
   FIJAR_DIA: {"dias": ["Lun","Mar"], "modo": "PERMITIR|EXCLUIR"}
   FECHA_LIMITE: {"dia_limite": "Jue"}
   SECUENCIA: {"modelo_antes": "65413", "modelo_despues": "77525"}
   AGRUPAR_MODELOS: {"modelo_a": "65413", "modelo_b": "77525"}
   AJUSTE_VOLUMEN: {"nuevo_volumen": 500}
   LOTE_MINIMO_CUSTOM: {"lote_minimo": 50}
   ROBOT_NO_DISPONIBLE: {"robot": "3020-M4", "dias": ["Lun","Mar"]}
   AUSENCIA_OPERARIO: {"dia": "Mar", "cantidad": 2}
   CAPACIDAD_DIA: {"dia": "Mar", "nueva_plantilla": 15}
   PRECEDENCIA_OPERACION: {"fraccion_origen": 1, "fraccion_destino": 3, "buffer_pares": 50}';


-- ============================================================
-- 7. AVANCE DE PRODUCCION
-- ============================================================

CREATE TABLE avance (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  semana      TEXT NOT NULL,                  -- "sem_8_2026"
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pares completados por modelo y dia
CREATE TABLE avance_detalle (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  avance_id   UUID NOT NULL REFERENCES avance(id) ON DELETE CASCADE,
  modelo_num  TEXT NOT NULL,
  dia         day_name NOT NULL,
  pares       INT NOT NULL DEFAULT 0,
  UNIQUE (avance_id, modelo_num, dia)
);


-- ============================================================
-- 8. RESULTADOS DE OPTIMIZACION
-- ============================================================

CREATE TABLE resultados (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre                TEXT NOT NULL UNIQUE,     -- "sem_8_2026_v1"
  base_name             TEXT NOT NULL,             -- "sem_8_2026"
  version               INT NOT NULL DEFAULT 1,
  nota                  TEXT DEFAULT '',
  fecha_optimizacion    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Datos pesados almacenados como JSONB
  weekly_schedule       JSONB DEFAULT '[]',
  weekly_summary        JSONB DEFAULT '{}',
  daily_results         JSONB DEFAULT '{}',

  -- Snapshot del input usado (para reproducibilidad)
  pedido_snapshot       JSONB DEFAULT '[]',
  params_snapshot       JSONB DEFAULT '{}',

  UNIQUE (base_name, version)
);


-- ============================================================
-- 9. INDICES
-- ============================================================

CREATE INDEX idx_catalogo_ops_modelo ON catalogo_operaciones(modelo_id);
CREATE INDEX idx_catalogo_ops_recurso ON catalogo_operaciones(recurso);
CREATE INDEX idx_cat_op_robots_op ON catalogo_operacion_robots(operacion_id);
CREATE INDEX idx_cat_op_robots_robot ON catalogo_operacion_robots(robot_id);
CREATE INDEX idx_pedido_items_pedido ON pedido_items(pedido_id);
CREATE INDEX idx_pedido_items_modelo ON pedido_items(modelo_num);
CREATE INDEX idx_restricciones_tipo ON restricciones(tipo);
CREATE INDEX idx_restricciones_modelo ON restricciones(modelo_num);
CREATE INDEX idx_restricciones_semana ON restricciones(semana);
CREATE INDEX idx_avance_detalle_avance ON avance_detalle(avance_id);
CREATE INDEX idx_resultados_base ON resultados(base_name);
CREATE INDEX idx_operario_recursos_op ON operario_recursos(operario_id);
CREATE INDEX idx_operario_robots_op ON operario_robots(operario_id);
CREATE INDEX idx_operario_dias_op ON operario_dias(operario_id);


-- ============================================================
-- 10. TRIGGERS: updated_at automatico
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_catalogo_modelos_updated
  BEFORE UPDATE ON catalogo_modelos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_operarios_updated
  BEFORE UPDATE ON operarios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_avance_updated
  BEFORE UPDATE ON avance
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 11. DATOS INICIALES (Seed)
-- ============================================================

-- Robots fisicos (15 robots del template, orden segun hoja ROBOTS_FISICOS)
INSERT INTO robots (nombre, estado, area, orden) VALUES
  ('2A-3020-M1', 'ACTIVO', 'PESPUNTE', 1),
  ('2A-3020-M2', 'ACTIVO', 'PESPUNTE', 2),
  ('3020-M4',    'ACTIVO', 'AVIOS', 3),
  ('3020-M6',    'ACTIVO', 'AVIOS', 4),
  ('6040-M4',    'ACTIVO', 'PESPUNTE', 5),
  ('6040-M5',    'ACTIVO', 'PESPUNTE', 6),
  ('CHACHE 048', 'ACTIVO', 'PESPUNTE', 7),
  ('CHACHE 049', 'ACTIVO', 'PESPUNTE', 8),
  ('6040-M1',    'FUERA DE SERVICIO', 'PESPUNTE', 9),
  ('6040-M2',    'FUERA DE SERVICIO', 'PESPUNTE', 10),
  ('6040-M3',    'FUERA DE SERVICIO', 'PESPUNTE', 11),
  ('3020-M3',    'FUERA DE SERVICIO', 'PESPUNTE', 12),
  ('3020-M1',    'ACTIVO', 'PESPUNTE', 13),
  ('3020-M2',    'ACTIVO', 'PESPUNTE', 14),
  ('3020-M5',    'FUERA DE SERVICIO', 'PESPUNTE', 15);

-- Aliases de robots (para parseo de Excel legacy)
INSERT INTO robot_aliases (alias, robot_id)
  SELECT '3020 M-4', id FROM robots WHERE nombre = '3020-M4';
INSERT INTO robot_aliases (alias, robot_id)
  SELECT '6040-M5 (PARCIAL)', id FROM robots WHERE nombre = '6040-M5';

-- Fabricas (hoja FABRICAS)
INSERT INTO fabricas (nombre, orden) VALUES
  ('FABRICA 1', 1),
  ('FABRICA 2', 2),
  ('FABRICA 3', 3);

-- Capacidades por recurso (hoja CAPACIDADES_RECURSO)
INSERT INTO capacidades_recurso (tipo, pares_hora) VALUES
  ('GENERAL', 10),
  ('MESA', 15),
  ('PLANA', 8),
  ('POSTE', 6),
  ('ROBOT', 8),
  ('MAQUILA', 1);

-- Dias laborales (hoja DIAS_LABORALES)
INSERT INTO dias_laborales (nombre, orden, minutos, plantilla, minutos_ot, plantilla_ot, es_sabado) VALUES
  ('Sab', 0, 300, 10, 120, 15, TRUE),
  ('Lun', 1, 540, 17,  60, 17, FALSE),
  ('Mar', 2, 540, 17,  60, 17, FALSE),
  ('Mie', 3, 540, 17,  60, 17, FALSE),
  ('Jue', 4, 540, 17,  60, 17, FALSE),
  ('Vie', 5, 540, 17,  60, 17, FALSE);

-- Horarios (hojas HORARIO_LABORAL + HORARIO_FINSEMANA)
INSERT INTO horarios (tipo, entrada, salida, comida_inicio, comida_fin, bloque_min) VALUES
  ('SEMANA',    '08:00', '18:00', '14:00', '15:00', 60),
  ('FINSEMANA', '08:00', '13:00', NULL,    NULL,    60);

-- Pesos de priorizacion (hoja PESOS_PRIORIZACION)
INSERT INTO pesos_priorizacion (nombre, valor) VALUES
  ('tardiness',  100000),
  ('balance',     30000),
  ('span',        20000),
  ('changeover',  10000),
  ('odd_lot',      5000),
  ('saturday',      500),
  ('uniformity',    100),
  ('overtime',       10),
  ('early_start',     5);

-- Parametros del optimizador (hoja PARAMETROS_OPTIM)
INSERT INTO parametros_optimizacion (nombre, valor) VALUES
  ('lote_minimo',         50),
  ('lote_preferido',     100),
  ('factor_eficiencia',    0.90),
  ('factor_contiguidad',   0.80),
  ('timeout_solver',      90),
  ('lead_time_maquila',    3);

-- Operarios (hoja OPERARIOS)
INSERT INTO operarios (nombre, fabrica_id, eficiencia, activo)
  SELECT 'ARACELI', id, 1.0, TRUE FROM fabricas WHERE nombre = 'FABRICA 1';
INSERT INTO operarios (nombre, fabrica_id, eficiencia, activo)
  SELECT 'DIANA', id, 1.1, TRUE FROM fabricas WHERE nombre = 'FABRICA 1';
INSERT INTO operarios (nombre, fabrica_id, eficiencia, activo)
  SELECT 'HUGO', id, 1.0, TRUE FROM fabricas WHERE nombre = 'FABRICA 1';
INSERT INTO operarios (nombre, fabrica_id, eficiencia, activo)
  SELECT 'CARLOS', id, 0.9, TRUE FROM fabricas WHERE nombre = 'FABRICA 2';
INSERT INTO operarios (nombre, fabrica_id, eficiencia, activo)
  SELECT 'ROBERTO', id, 1.0, TRUE FROM fabricas WHERE nombre = 'FABRICA 2';
INSERT INTO operarios (nombre, fabrica_id, eficiencia, activo)
  SELECT 'MARIA', id, 1.2, TRUE FROM fabricas WHERE nombre = 'FABRICA 1';
INSERT INTO operarios (nombre, fabrica_id, eficiencia, activo)
  SELECT 'JORGE', id, 0.95, TRUE FROM fabricas WHERE nombre = 'FABRICA 2';
INSERT INTO operarios (nombre, fabrica_id, eficiencia, activo)
  SELECT 'PATRICIA', id, 1.0, TRUE FROM fabricas WHERE nombre = 'FABRICA 1';

-- Operario recursos habilitados
INSERT INTO operario_recursos (operario_id, recurso)
  SELECT id, 'MESA'::resource_type FROM operarios WHERE nombre = 'ARACELI';
INSERT INTO operario_recursos (operario_id, recurso)
  SELECT id, 'PLANA'::resource_type FROM operarios WHERE nombre = 'ARACELI';
INSERT INTO operario_recursos (operario_id, recurso)
  SELECT id, 'MESA'::resource_type FROM operarios WHERE nombre = 'DIANA';
INSERT INTO operario_recursos (operario_id, recurso)
  SELECT id, 'PLANA'::resource_type FROM operarios WHERE nombre = 'DIANA';
INSERT INTO operario_recursos (operario_id, recurso)
  SELECT id, 'ROBOT'::resource_type FROM operarios WHERE nombre = 'HUGO';
INSERT INTO operario_recursos (operario_id, recurso)
  SELECT id, 'MESA'::resource_type FROM operarios WHERE nombre = 'HUGO';
INSERT INTO operario_recursos (operario_id, recurso)
  SELECT id, 'MESA'::resource_type FROM operarios WHERE nombre = 'CARLOS';
INSERT INTO operario_recursos (operario_id, recurso)
  SELECT id, 'PLANA'::resource_type FROM operarios WHERE nombre = 'CARLOS';
INSERT INTO operario_recursos (operario_id, recurso)
  SELECT id, 'POSTE'::resource_type FROM operarios WHERE nombre = 'CARLOS';
INSERT INTO operario_recursos (operario_id, recurso)
  SELECT id, 'ROBOT'::resource_type FROM operarios WHERE nombre = 'ROBERTO';
INSERT INTO operario_recursos (operario_id, recurso)
  SELECT id, 'MESA'::resource_type FROM operarios WHERE nombre = 'MARIA';
INSERT INTO operario_recursos (operario_id, recurso)
  SELECT id, 'PLANA'::resource_type FROM operarios WHERE nombre = 'MARIA';
INSERT INTO operario_recursos (operario_id, recurso)
  SELECT id, 'ROBOT'::resource_type FROM operarios WHERE nombre = 'JORGE';
INSERT INTO operario_recursos (operario_id, recurso)
  SELECT id, 'MESA'::resource_type FROM operarios WHERE nombre = 'JORGE';
INSERT INTO operario_recursos (operario_id, recurso)
  SELECT id, 'MESA'::resource_type FROM operarios WHERE nombre = 'PATRICIA';
INSERT INTO operario_recursos (operario_id, recurso)
  SELECT id, 'PLANA'::resource_type FROM operarios WHERE nombre = 'PATRICIA';

-- Operario robots habilitados
INSERT INTO operario_robots (operario_id, robot_id)
  SELECT o.id, r.id FROM operarios o, robots r WHERE o.nombre = 'HUGO' AND r.nombre = '3020-M4';
INSERT INTO operario_robots (operario_id, robot_id)
  SELECT o.id, r.id FROM operarios o, robots r WHERE o.nombre = 'HUGO' AND r.nombre = '6040-M5';
INSERT INTO operario_robots (operario_id, robot_id)
  SELECT o.id, r.id FROM operarios o, robots r WHERE o.nombre = 'ROBERTO' AND r.nombre = '2A-3020-M1';
INSERT INTO operario_robots (operario_id, robot_id)
  SELECT o.id, r.id FROM operarios o, robots r WHERE o.nombre = 'ROBERTO' AND r.nombre = '2A-3020-M2';
INSERT INTO operario_robots (operario_id, robot_id)
  SELECT o.id, r.id FROM operarios o, robots r WHERE o.nombre = 'ROBERTO' AND r.nombre = 'CHACHE 048';
INSERT INTO operario_robots (operario_id, robot_id)
  SELECT o.id, r.id FROM operarios o, robots r WHERE o.nombre = 'JORGE' AND r.nombre = '6040-M4';
INSERT INTO operario_robots (operario_id, robot_id)
  SELECT o.id, r.id FROM operarios o, robots r WHERE o.nombre = 'JORGE' AND r.nombre = 'CHACHE 049';

-- Operario dias disponibles
-- ARACELI, DIANA, CARLOS, MARIA, JORGE: Lun-Vie
-- HUGO, ROBERTO: Lun-Sab
-- PATRICIA: Lun-Jue
INSERT INTO operario_dias (operario_id, dia)
  SELECT o.id, d.nombre FROM operarios o, dias_laborales d
  WHERE o.nombre IN ('ARACELI','DIANA','CARLOS','MARIA','JORGE')
    AND d.nombre IN ('Lun','Mar','Mie','Jue','Vie');
INSERT INTO operario_dias (operario_id, dia)
  SELECT o.id, d.nombre FROM operarios o, dias_laborales d
  WHERE o.nombre IN ('HUGO','ROBERTO')
    AND d.nombre IN ('Lun','Mar','Mie','Jue','Vie','Sab');
INSERT INTO operario_dias (operario_id, dia)
  SELECT o.id, d.nombre FROM operarios o, dias_laborales d
  WHERE o.nombre = 'PATRICIA'
    AND d.nombre IN ('Lun','Mar','Mie','Jue');


-- ============================================================
-- 12. ROW LEVEL SECURITY (preparado, no activado aun)
-- ============================================================
-- Cuando se implemente auth, activar RLS:
-- ALTER TABLE robots ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Allow all" ON robots FOR ALL USING (true);
-- (repetir para cada tabla)
