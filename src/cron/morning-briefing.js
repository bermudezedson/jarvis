const briefingSkill = require('../skills/daily-briefing');
const logger = require('../utils/logger');

async function run() {
  logger.info('Morning briefing cron triggered', { skill: 'cron:morning' });
  try {
    await briefingSkill.generate('morning');
    logger.info('Morning briefing completed', { skill: 'cron:morning' });
  } catch (err) {
    logger.error('Morning briefing failed', { skill: 'cron:morning', error: err.message });
  }

  // Incremental client scan — only fetches threads since last scan
  try {
    const mailOps = require('../skills/mail-ops');
    await mailOps.classifyClientThreads({ mode: 'incremental' });
    logger.info('Cron: incremental client scan done', { skill: 'cron:morning' });
  } catch (err) {
    logger.error('Cron: client scan failed', { skill: 'cron:morning', error: err.message });
  }
}

module.exports = { run };
