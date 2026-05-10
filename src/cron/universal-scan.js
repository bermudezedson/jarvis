const logger = require('../utils/logger');

async function run() {
  logger.info('Universal scan cron triggered', { skill: 'cron:universal' });
  try {
    const mailOps = require('../skills/mail-ops');
    const result  = await mailOps.runUniversalScan({ timeWindowMinutes: 90 });
    logger.info('Universal scan cron done', { skill: 'cron:universal', ...result.scan });
  } catch (err) {
    logger.error('Universal scan cron failed', { skill: 'cron:universal', error: err.message });
  }
}

module.exports = { run };
