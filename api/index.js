const env = require('../src/config/environment');
const db = require('../src/config/database');
const { runMigrations } = require('../database/migrate');
const { ensureCoreFoundation, seedDemoData } = require('../database/seeds/seed');
const { createApp } = require('../src/app');

const app = createApp();
let bootPromise = null;

function ensureBootstrapped() {
  if (!bootPromise) {
    bootPromise = (async () => {
      await db.initDatabase();
      await runMigrations();
      if (env.defaults.autoSeedDemo) {
        await seedDemoData();
      } else {
        await ensureCoreFoundation();
      }
    })().catch((err) => {
      bootPromise = null;
      throw err;
    });
  }
  return bootPromise;
}

module.exports = async function vercelHandler(req, res) {
  await ensureBootstrapped();
  return app(req, res);
};
