const env = require('./config/environment');
const db = require('./config/database');
const logger = require('./utils/logger');
const { ensureCoreFoundation, seedDemoData } = require('../database/seeds/seed');
const { createApp } = require('./app');

async function bootstrap() {
  await db.initDatabase();
  if (env.defaults.autoSeedDemo) {
    await seedDemoData();
  } else {
    await ensureCoreFoundation();
  }

  const app = createApp();
  const server = app.listen(env.port, env.host, () => {
    logger.info(`School Management System running on http://${env.host}:${env.port}`, {
      env: env.nodeEnv,
      dbDriver: db.getActiveDriver(),
      googleOAuth: env.google.isConfigured ? 'enabled' : 'awaiting_credentials',
    });
  });

  const shutdown = async (signal) => {
    logger.info(`Received ${signal}; shutting down gracefully...`);
    server.close(async () => {
      await db.closeDatabase();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
  bootstrap().catch((err) => {
    logger.error('Failed to bootstrap SMS server', { error: err.message });
    process.exit(1);
  });
}

module.exports = { bootstrap };
