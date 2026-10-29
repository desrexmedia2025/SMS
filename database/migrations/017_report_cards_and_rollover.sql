-- =============================================================================
-- Migration 017: Per-term report cards (class position, grading, remarks)
-- and end-of-term / end-of-year class promotion.
-- =============================================================================

CREATE TABLE IF NOT EXISTS report_cards (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  class_id INT NOT NULL,
  academic_year_id INT NOT NULL,
  term_id INT NOT NULL,
  overall_average DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  gpa DECIMAL(4,2) NOT NULL DEFAULT 0.00,
  overall_grade VARCHAR(10) NOT NULL DEFAULT '',
  class_position INT DEFAULT NULL,
  class_size INT NOT NULL DEFAULT 0,
  subjects_count INT NOT NULL DEFAULT 0,
  attendance_summary VARCHAR(80) NOT NULL DEFAULT '',
  teacher_remark TEXT,
  headteacher_remark TEXT,
  generated_by_user_id INT DEFAULT NULL,
  generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (student_id, academic_year_id, term_id)
);

CREATE INDEX IF NOT EXISTS idx_report_cards_class ON report_cards (class_id, academic_year_id, term_id);
CREATE INDEX IF NOT EXISTS idx_report_cards_student ON report_cards (student_id);
