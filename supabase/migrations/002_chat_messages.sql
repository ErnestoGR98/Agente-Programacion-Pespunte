-- ============================================================
-- Pespunte Agent - Chat Messages
-- Migracion: 002_chat_messages.sql
-- Fecha: 2026-02-23
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  semana      TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_chat_semana ON chat_messages(semana);
CREATE INDEX idx_chat_created ON chat_messages(created_at);

-- RLS: permitir acceso anonimo (mismo patron que las demas tablas)
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat_messages_anon" ON chat_messages
  FOR ALL USING (true) WITH CHECK (true);
