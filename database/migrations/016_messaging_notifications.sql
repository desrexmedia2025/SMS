-- =============================================================================
-- Migration 016: Internal Messaging & Notification Bell
-- Threads + participants + messages, with attachments reusing media_attachments.
-- =============================================================================

CREATE TABLE IF NOT EXISTS message_threads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  subject VARCHAR(160) NOT NULL DEFAULT '',
  audience_type VARCHAR(20) NOT NULL DEFAULT 'user',
  audience_value VARCHAR(80) NOT NULL DEFAULT '',
  audience_label VARCHAR(160) NOT NULL DEFAULT '',
  created_by_user_id INT NOT NULL,
  last_message_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS message_participants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  thread_id INT NOT NULL,
  user_id INT NOT NULL,
  last_read_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (thread_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  thread_id INT NOT NULL,
  sender_user_id INT NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages (thread_id, id);
CREATE INDEX IF NOT EXISTS idx_message_participants_user ON message_participants (user_id);
CREATE INDEX IF NOT EXISTS idx_message_threads_last_message ON message_threads (last_message_at);
