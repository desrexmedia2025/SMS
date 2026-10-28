const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const env = require('./environment');
const logger = require('../utils/logger');

let activeDriver = null; // 'mysql' | 'sqlite'
let mysqlPool = null;
let sqliteDb = null;
let txDepth = 0;

function normalizeParams(params = []) {
  return params.map((val) => {
    if (val === undefined) return null;
    if (typeof val === 'boolean') return val ? 1 : 0;
    return val;
  });
}

function initSqlite(sqliteFilePath) {
  const { DatabaseSync } = require('node:sqlite');
  if (sqliteFilePath !== ':memory:') {
    fs.mkdirSync(path.dirname(sqliteFilePath), { recursive: true });
  }
  const dbInstance = new DatabaseSync(sqliteFilePath);
  dbInstance.exec('PRAGMA foreign_keys = ON;');
  dbInstance.exec('PRAGMA journal_mode = WAL;');
  dbInstance.exec('PRAGMA busy_timeout = 5000;');
  return dbInstance;
}

async function initDatabase(options = {}) {
  if (activeDriver && !options.forceReinit) {
    return { driver: activeDriver };
  }

  const requestedDriver = (options.driver || env.db.driver || 'mysql').toLowerCase();
  const sqliteFile = options.sqlitePath || env.db.sqlitePath;

  if (requestedDriver === 'mysql') {
    try {
      const pool = mysql.createPool({
        host: env.db.host,
        port: env.db.port,
        user: env.db.user,
        password: env.db.password,
        database: env.db.name,
        waitForConnections: true,
        connectionLimit: env.db.connectionLimit,
        queueLimit: 0,
        timezone: 'Z',
      });
      const conn = await pool.getConnection();
      await conn.ping();
      conn.release();
      mysqlPool = pool;
      activeDriver = 'mysql';
      logger.info('Connected to MySQL/MariaDB database', {
        host: env.db.host,
        port: env.db.port,
        database: env.db.name,
      });
      return { driver: activeDriver };
    } catch (err) {
      if (!env.db.autoFallback) {
        logger.error('Failed to connect to MySQL/MariaDB and DB_AUTO_FALLBACK is disabled', {
          error: err.message,
        });
        throw err;
      }
      logger.warn('MySQL/MariaDB unavailable; using embedded SQLite development engine', {
        reason: err.message,
        sqlitePath: sqliteFile,
      });
    }
  }

  sqliteDb = initSqlite(sqliteFile);
  activeDriver = 'sqlite';
  return { driver: activeDriver };
}

function createRunner(mysqlConn = null) {
  return {
    get driver() {
      return activeDriver;
    },

    async query(sql, params = []) {
      const cleanParams = normalizeParams(params);
      if (activeDriver === 'mysql') {
        const executor = mysqlConn || mysqlPool;
        const [rows] = await executor.execute(sql, cleanParams);
        return Array.isArray(rows) ? rows : [];
      }
      const stmt = sqliteDb.prepare(sql);
      return stmt.all(...cleanParams);
    },

    async get(sql, params = []) {
      const rows = await this.query(sql, params);
      return rows[0] || null;
    },

    async run(sql, params = []) {
      const cleanParams = normalizeParams(params);
      if (activeDriver === 'mysql') {
        const executor = mysqlConn || mysqlPool;
        const [result] = await executor.execute(sql, cleanParams);
        return {
          insertId: result.insertId || null,
          affectedRows: result.affectedRows || 0,
        };
      }
      const stmt = sqliteDb.prepare(sql);
      const result = stmt.run(...cleanParams);
      return {
        insertId: result.lastInsertRowid !== undefined ? Number(result.lastInsertRowid) : null,
        affectedRows: Number(result.changes || 0),
      };
    },

    async execRaw(sql) {
      if (activeDriver === 'mysql') {
        const executor = mysqlConn || mysqlPool;
        await executor.query(sql);
        return;
      }
      sqliteDb.exec(sql);
    },
  };
}

const defaultRunner = createRunner(null);

async function withTransaction(workFn) {
  if (!activeDriver) {
    await initDatabase();
  }
  if (activeDriver === 'mysql') {
    const conn = await mysqlPool.getConnection();
    try {
      await conn.beginTransaction();
      const txRunner = createRunner(conn);
      const result = await workFn(txRunner);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  const savepoint = `sp_${++txDepth}`;
  const isOuter = txDepth === 1;
  try {
    sqliteDb.exec(isOuter ? 'BEGIN IMMEDIATE;' : `SAVEPOINT ${savepoint};`);
    const result = await workFn(defaultRunner);
    sqliteDb.exec(isOuter ? 'COMMIT;' : `RELEASE SAVEPOINT ${savepoint};`);
    return result;
  } catch (err) {
    try {
      sqliteDb.exec(isOuter ? 'ROLLBACK;' : `ROLLBACK TO SAVEPOINT ${savepoint};`);
    } catch (_) {
      // ignore rollback secondary failure
    }
    throw err;
  } finally {
    txDepth--;
  }
}

async function healthCheck() {
  if (!activeDriver) {
    await initDatabase();
  }
  const row = await defaultRunner.get('SELECT 1 AS ok');
  return {
    connected: Boolean(row && Number(row.ok) === 1),
    driver: activeDriver,
    database: activeDriver === 'mysql' ? env.db.name : path.basename(env.db.sqlitePath),
  };
}

async function closeDatabase() {
  if (mysqlPool) {
    await mysqlPool.end();
    mysqlPool = null;
  }
  if (sqliteDb) {
    sqliteDb.close();
    sqliteDb = null;
  }
  activeDriver = null;
}

module.exports = {
  initDatabase,
  closeDatabase,
  healthCheck,
  withTransaction,
  query: (sql, params) => defaultRunner.query(sql, params),
  get: (sql, params) => defaultRunner.get(sql, params),
  run: (sql, params) => defaultRunner.run(sql, params),
  execRaw: (sql) => defaultRunner.execRaw(sql),
  getActiveDriver: () => activeDriver,
};
