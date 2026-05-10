require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const logger = require('./utils/logger');
const routes = require('./api/routes');
const { errorHandler, requestLogger } = require('./api/middleware');
const morningBriefing = require('./cron/morning-briefing');
const eveningClosing  = require('./cron/evening-closing');
const universalScan   = require('./cron/universal-scan');

const rules = yaml.load(fs.readFileSync(path.join(__dirname, '../config/rules.yml'), 'utf8'));
const PORT = process.env.PORT || 3000;

// Seed DB contacts from clients.yml on startup
try {
  const clientsPath = path.join(__dirname, '../config/clients.yml');
  if (fs.existsSync(clientsPath)) {
    const clientsConfig = yaml.load(fs.readFileSync(clientsPath, 'utf8'));
    const db = require('./db/database');
    db.init();
    db.seedContactsFromConfig(Array.isArray(clientsConfig) ? clientsConfig : (clientsConfig.clients || []));
  }
} catch (e) {
  // Non-fatal: contacts will just be unseeded
}

const app = express();

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());
app.use(requestLogger);
app.use('/api', routes);
app.use(errorHandler);

cron.schedule(rules.briefing.morning_cron, morningBriefing.run, { timezone: rules.timezone });
cron.schedule(rules.briefing.evening_cron, eveningClosing.run, { timezone: rules.timezone });

// Universal inbox scan — every hour
const universalScanCron = rules.client_scan?.universal_cron || '0 * * * *';
cron.schedule(universalScanCron, universalScan.run, { timezone: rules.timezone });

// Incremental mail scan — every 4 hours
const mailIncrementalCron = rules.client_scan?.incremental_cron || rules.briefing?.incremental_cron || '0 */4 * * *';
cron.schedule(mailIncrementalCron, async () => {
  logger.info('Incremental mail scan triggered', { skill: 'cron:incremental' });
  try {
    const mailOps = require('./skills/mail-ops');
    await mailOps.classifyClientThreads({ mode: 'incremental' });
    logger.info('Incremental mail scan done', { skill: 'cron:incremental' });
  } catch (err) {
    logger.error('Incremental mail scan failed', { skill: 'cron:incremental', error: err.message });
  }
}, { timezone: rules.timezone });

// Auto state-machine rules — every 30 min (recalculates without calling Gmail)
const refreshStatesCron = rules.briefing.refresh_states_cron || '*/30 * * * *';
cron.schedule(refreshStatesCron, async () => {
  try {
    const sm = require('./skills/state-machine');
    await sm.runAutoRules();
  } catch (err) {
    logger.error('Auto rules cron failed', { skill: 'cron:states', error: err.message });
  }
}, { timezone: rules.timezone });

app.listen(PORT, () => {
  logger.info('Jarvis API started', { port: PORT, env: process.env.NODE_ENV || 'development' });
  logger.info('Cron jobs scheduled', {
    morning: rules.briefing.morning_cron,
    evening: rules.briefing.evening_cron,
    universal: universalScanCron,
    incremental: mailIncrementalCron,
    refresh_states: refreshStatesCron,
    timezone: rules.timezone,
  });
});
