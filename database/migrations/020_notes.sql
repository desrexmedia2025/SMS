-- =============================================================================
-- Migration 020: Personal Notes (lightweight word processor on every dashboard)
-- Each user owns private notes that can hold rich text, images, videos and file
-- attachments. Attachments reuse the existing media_attachments pipeline with
-- owner_type = 'note', so streaming and access control stay in one place.
-- =============================================================================

CREATE TABLE IF NOT EXISTS notes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(200) NOT NULL DEFAULT '',
  content TEXT,
  excerpt VARCHAR(300) NOT NULL DEFAULT '',
  color VARCHAR(9) NOT NULL DEFAULT '#1d4ed8',
  pinned TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notes_user_updated ON notes (user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_notes_user_pinned ON notes (user_id, pinned);
