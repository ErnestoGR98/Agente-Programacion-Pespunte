-- ============================================================
-- Pespunte Agent - Aislamiento por usuario
-- Migracion: 003_user_isolation.sql
-- Fecha: 2026-02-23
-- ============================================================

-- 1. Agregar user_id a tablas de datos por usuario
ALTER TABLE pedidos       ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();
ALTER TABLE restricciones ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();
ALTER TABLE avance        ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();
ALTER TABLE resultados    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();

-- 2. Indices para filtrado rapido
CREATE INDEX IF NOT EXISTS idx_pedidos_user       ON pedidos(user_id);
CREATE INDEX IF NOT EXISTS idx_restricciones_user ON restricciones(user_id);
CREATE INDEX IF NOT EXISTS idx_avance_user        ON avance(user_id);
CREATE INDEX IF NOT EXISTS idx_resultados_user    ON resultados(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id);

-- 3. Habilitar RLS en tablas de datos por usuario
ALTER TABLE pedidos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedido_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE restricciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE avance        ENABLE ROW LEVEL SECURITY;
ALTER TABLE avance_detalle ENABLE ROW LEVEL SECURITY;
ALTER TABLE resultados    ENABLE ROW LEVEL SECURITY;

-- chat_messages ya tiene RLS habilitado, solo reemplazar la politica
DROP POLICY IF EXISTS "chat_messages_anon" ON chat_messages;

-- 4. Politicas RLS: cada usuario solo ve sus datos
CREATE POLICY "pedidos_user" ON pedidos
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- pedido_items hereda acceso via pedido (join con pedidos del mismo user)
CREATE POLICY "pedido_items_user" ON pedido_items
  FOR ALL USING (
    pedido_id IN (SELECT id FROM pedidos WHERE user_id = auth.uid())
  ) WITH CHECK (
    pedido_id IN (SELECT id FROM pedidos WHERE user_id = auth.uid())
  );

CREATE POLICY "restricciones_user" ON restricciones
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "avance_user" ON avance
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "avance_detalle_user" ON avance_detalle
  FOR ALL USING (
    avance_id IN (SELECT id FROM avance WHERE user_id = auth.uid())
  ) WITH CHECK (
    avance_id IN (SELECT id FROM avance WHERE user_id = auth.uid())
  );

CREATE POLICY "resultados_user" ON resultados
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "chat_messages_user" ON chat_messages
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 5. Tablas compartidas (catalogo, config) - acceso de lectura para todos los autenticados
ALTER TABLE catalogo_modelos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogo_operaciones  ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogo_operacion_robots ENABLE ROW LEVEL SECURITY;
ALTER TABLE fabricas              ENABLE ROW LEVEL SECURITY;
ALTER TABLE modelo_fabrica        ENABLE ROW LEVEL SECURITY;
ALTER TABLE robots                ENABLE ROW LEVEL SECURITY;
ALTER TABLE robot_aliases         ENABLE ROW LEVEL SECURITY;
ALTER TABLE dias_laborales        ENABLE ROW LEVEL SECURITY;
ALTER TABLE capacidades_recurso   ENABLE ROW LEVEL SECURITY;
ALTER TABLE horarios              ENABLE ROW LEVEL SECURITY;
ALTER TABLE pesos_priorizacion    ENABLE ROW LEVEL SECURITY;
ALTER TABLE parametros_optimizacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE operarios             ENABLE ROW LEVEL SECURITY;
ALTER TABLE operario_recursos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE operario_robots       ENABLE ROW LEVEL SECURITY;
ALTER TABLE operario_dias         ENABLE ROW LEVEL SECURITY;

-- Lectura para cualquier usuario autenticado, escritura para todos (admin crea desde dashboard)
CREATE POLICY "shared_read" ON catalogo_modelos FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "shared_write" ON catalogo_modelos FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "shared_read" ON catalogo_operaciones FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "shared_write" ON catalogo_operaciones FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "shared_read" ON catalogo_operacion_robots FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "shared_write" ON catalogo_operacion_robots FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "shared_read" ON fabricas FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "shared_write" ON fabricas FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "shared_read" ON modelo_fabrica FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "shared_write" ON modelo_fabrica FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "shared_read" ON robots FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "shared_write" ON robots FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "shared_read" ON robot_aliases FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "shared_write" ON robot_aliases FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "shared_read" ON dias_laborales FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "shared_write" ON dias_laborales FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "shared_read" ON capacidades_recurso FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "shared_write" ON capacidades_recurso FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "shared_read" ON horarios FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "shared_write" ON horarios FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "shared_read" ON pesos_priorizacion FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "shared_write" ON pesos_priorizacion FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "shared_read" ON parametros_optimizacion FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "shared_write" ON parametros_optimizacion FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "shared_read" ON operarios FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "shared_write" ON operarios FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "shared_read" ON operario_recursos FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "shared_write" ON operario_recursos FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "shared_read" ON operario_robots FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "shared_write" ON operario_robots FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "shared_read" ON operario_dias FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "shared_write" ON operario_dias FOR ALL USING (true) WITH CHECK (true);

-- 6. Permitir acceso del service_role (backend) a todas las tablas
-- El service_role key bypasea RLS automaticamente, no necesita politicas adicionales.
