-- =============================================================================
-- Migration 015: School-wide Calendar Events (holidays, PTA meetings, exam weeks,
-- sports day, ...) created by the Superadmin and shown on all four dashboards.
-- =============================================================================

CREATE TABLE IF NOT EXISTS school_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  description TEXT,
  event_type VARCHAR(30) NOT NULL DEFAULT 'other',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  color VARCHAR(9) NOT NULL DEFAULT '#2563eb',
  audience VARCHAR(20) NOT NULL DEFAULT 'all',
  created_by_user_id INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_school_events_range ON school_events (start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_school_events_audience ON school_events (audience);
