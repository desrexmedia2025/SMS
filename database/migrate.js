const fs = require('fs');
const path = require('path');
const db = require('../src/config/database');
const logger = require('../src/utils/logger');

function adaptMysqlSqlToSqlite(sql) {
  return sql
    .replace(/ENGINE\s*=\s*InnoDB[^;]*/gi, '')
    .replace(/\bINT\s+AUTO_INCREMENT\s+PRIMARY\s+KEY\b/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT')
    .replace(/\bTINYINT\s*\(\s*1\s*\)/gi, 'INTEGER')
    .replace(/\bBIGINT\b/gi, 'INTEGER');
}

function splitSqlStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) =>
      s
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim()
    )
    .filter(Boolean);
}

async function runMigrations() {
  const { driver } = await db.initDatabase();
  const migrationsDir = path.resolve(__dirname, 'migrations');

  const bootstrapSql = `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(120) PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await db.execRaw(bootstrapSql);

  const appliedRows = await db.query('SELECT version FROM schema_migrations ORDER BY version ASC');
  const applied = new Set(appliedRows.map((r) => r.version));

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const newlyApplied = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const rawSql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const targetSql = driver === 'sqlite' ? adaptMysqlSqlToSqlite(rawSql) : rawSql;
    const statements = splitSqlStatements(targetSql);

    await db.withTransaction(async (tx) => {
      for (const stmt of statements) {
        try {
          await tx.execRaw(`${stmt};`);
        } catch (err) {
          // Handle idempotent re-run of ALTER TABLE ADD COLUMN or CREATE INDEX if column/index already exists
          const msg = String(err.message || '');
          if (/duplicate column name|already exists/i.test(msg)) {
            continue;
          }
          throw err;
        }
      }
      await tx.run('INSERT INTO schema_migrations (version) VALUES (?)', [file]);
    });

    newlyApplied.push(file);
    logger.info(`Applied migration: ${file}`, { driver });
  }

  return { driver, newlyApplied, totalMigrations: files.length };
}

if (require.main === module) {
  runMigrations()
    .then((res) => {
      logger.info('Migration check complete', res);
      return db.closeDatabase();
    })
    .catch((err) => {
      logger.error('Migration failed', { error: err.message });
      process.exit(1);
    });
}

module.exports = { runMigrations };
