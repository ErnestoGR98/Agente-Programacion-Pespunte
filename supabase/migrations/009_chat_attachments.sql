-- Add attachments column to chat_messages (JSONB array, nullable)
-- Stores metadata only: {type, filename, mime_type, size, preview?}
-- Base64 image data is NOT stored here to keep DB small
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT NULL;
