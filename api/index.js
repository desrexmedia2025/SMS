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

// `middleware.js` rewrites every request to `/api/index` and keeps the real
// request path inside the `p` query parameter. Put the original path back so
// Express routes exactly as it does when `vercel.json` rewrites the request.
function restoreOriginalUrl(req) {
  const raw = req.url || '/';
  const marker = '/api/index';
  if (raw !== marker && !raw.startsWith(`${marker}?`)) return;
  const queryIndex = raw.indexOf('?');
  if (queryIndex === -1) {
    req.url = '/';
    return;
  }
  const params = new URLSearchParams(raw.slice(queryIndex + 1));
  const original = params.get('p');
  req.url = original && original.startsWith('/') ? original : '/';
}

module.exports = async function vercelHandler(req, res) {
  await ensureBootstrapped();
  restoreOriginalUrl(req);
  return app(req, res);
};
