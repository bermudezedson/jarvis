const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  logger.error('Unhandled error', { path: req.path, error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error', message: err.message });
}

function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    logger.info(`${req.method} ${req.path}`, { status: res.statusCode, ms: Date.now() - start });
  });
  next();
}

module.exports = { errorHandler, requestLogger };
