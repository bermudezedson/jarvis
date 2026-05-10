const briefingSkill = require('../skills/daily-briefing');
const logger = require('../utils/logger');

async function run() {
  logger.info('Evening closing cron triggered', { skill: 'cron:evening' });
  try {
    await briefingSkill.generate('evening');
    logger.info('Evening closing completed', { skill: 'cron:evening' });
  } catch (err) {
    logger.error('Evening closing failed', { skill: 'cron:evening', error: err.message });
  }
}

module.exports = { run };
