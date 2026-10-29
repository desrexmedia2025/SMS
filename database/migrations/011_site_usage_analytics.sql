-- Incremental Migration 011: Lightweight Site Usage & Traffic Analytics
-- Stores minimal, privacy-safe route visit timestamps for Superadmin usage graphs

CREATE TABLE IF NOT EXISTS site_page_hits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  route_key VARCHAR(80) NOT NULL,
  role_slug VARCHAR(32) DEFAULT NULL,
  user_id INT DEFAULT NULL,
  hit_date VARCHAR(10) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE INDEX idx_site_page_hits_date ON site_page_hits (hit_date);
CREATE INDEX idx_site_page_hits_route ON site_page_hits (route_key);
