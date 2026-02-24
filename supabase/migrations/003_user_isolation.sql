-- ============================================================
-- Pespunte Agent - RLS: chat privado, resto compartido
-- Migracion: 003_user_isolation.sql
-- Fecha: 2026-02-23
-- ============================================================

-- ============================================================
-- 1. CHAT MESSAGES: privado por usuario
-- ============================================================

-- Agregar user_id solo a chat_messages
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();
CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id);

-- Reemplazar politica abierta por politica per-user
DROP POLICY IF EXISTS "chat_messages_anon" ON chat_messages;
DROP POLICY IF EXISTS "chat_messages_user" ON chat_messages;
CREATE POLICY "chat_messages_user" ON chat_messages
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 2. TABLAS DE DATOS: compartidas entre usuarios autenticados
-- ============================================================

ALTER TABLE pedidos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedido_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE restricciones  ENABLE ROW LEVEL SECURITY;
ALTER TABLE avance         ENABLE ROW LEVEL SECURITY;
ALTER TABLE avance_detalle ENABLE ROW LEVEL SECURITY;
ALTER TABLE resultados     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shared_all" ON pedidos       FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "shared_all" ON pedido_items  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "shared_all" ON restricciones FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "shared_all" ON avance        FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "shared_all" ON avance_detalle FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "shared_all" ON resultados    FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- 3. TABLAS DE CATALOGO/CONFIG: compartidas
-- ============================================================

ALTER TABLE catalogo_modelos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogo_operaciones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogo_operacion_robots ENABLE ROW LEVEL SECURITY;
ALTER TABLE fabricas                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE modelo_fabrica            ENABLE ROW LEVEL SECURITY;
ALTER TABLE robots                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE robot_aliases             ENABLE ROW LEVEL SECURITY;
ALTER TABLE dias_laborales            ENABLE ROW LEVEL SECURITY;
ALTER TABLE capacidades_recurso       ENABLE ROW LEVEL SECURITY;
ALTER TABLE horarios                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pesos_priorizacion        ENABLE ROW LEVEL SECURITY;
ALTER TABLE parametros_optimizacion   ENABLE ROW LEVEL SECURITY;
ALTER TABLE operarios                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE operario_recursos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE operario_robots           ENABLE ROW LEVEL SECURITY;
ALTER TABLE operario_dias             ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shared_all" ON catalogo_modelos          FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "shared_all" ON catalogo_operaciones      FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "shared_all" ON catalogo_operacion_robots FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "shared_all" ON fabricas                  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "shared_all" ON modelo_fabrica            FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "shared_all" ON robots                    FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "shared_all" ON robot_aliases             FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "shared_all" ON dias_laborales            FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "shared_all" ON capacidades_recurso       FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "shared_all" ON horarios                  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "shared_all" ON pesos_priorizacion        FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "shared_all" ON parametros_optimizacion   FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "shared_all" ON operarios                 FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "shared_all" ON operario_recursos         FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "shared_all" ON operario_robots           FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "shared_all" ON operario_dias             FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- NOTA: El backend usa service_role key que bypasea RLS automaticamente.
-- ============================================================
