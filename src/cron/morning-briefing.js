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
}

module.exports = { run };
