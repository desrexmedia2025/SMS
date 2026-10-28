-- =============================================================================
-- Migration 010: Teacher Coursework (Classwork, Homework, Tests, Exams),
-- Multimedia Uploads (PDF, Images, Videos, Documents) & Class Announcements
-- =============================================================================

CREATE TABLE IF NOT EXISTS coursework_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT NOT NULL,
  subject_id INT NOT NULL,
  academic_year_id INT DEFAULT NULL,
  term_id INT DEFAULT NULL,
  work_type VARCHAR(24) NOT NULL DEFAULT 'homework',
  title VARCHAR(200) NOT NULL,
  instructions TEXT NOT NULL,
  max_score DECIMAL(6,2) NOT NULL DEFAULT 100.00,
  due_at VARCHAR(40) DEFAULT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'published',
  created_by_user_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cw_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
  CONSTRAINT fk_cw_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
  CONSTRAINT fk_cw_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coursework_classes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  coursework_id INT NOT NULL,
  class_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (coursework_id, class_id),
  CONSTRAINT fk_cwc_cw FOREIGN KEY (coursework_id) REFERENCES coursework_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_cwc_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coursework_submissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  coursework_id INT NOT NULL,
  student_id INT NOT NULL,
  class_id INT NOT NULL,
  answer_text TEXT DEFAULT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'submitted',
  score DECIMAL(6,2) DEFAULT NULL,
  feedback TEXT DEFAULT NULL,
  graded_by_user_id INT DEFAULT NULL,
  graded_at DATETIME DEFAULT NULL,
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (coursework_id, student_id),
  CONSTRAINT fk_cws_cw FOREIGN KEY (coursework_id) REFERENCES coursework_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_cws_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_cws_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS media_attachments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  owner_type VARCHAR(24) NOT NULL,
  owner_id INT NOT NULL,
  uploaded_by_user_id INT NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) NOT NULL UNIQUE,
  mime_type VARCHAR(120) NOT NULL,
  media_kind VARCHAR(24) NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ma_uploader FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS announcement_classes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  announcement_id INT NOT NULL,
  class_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (announcement_id, class_id),
  CONSTRAINT fk_ac_ann FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
  CONSTRAINT fk_ac_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
