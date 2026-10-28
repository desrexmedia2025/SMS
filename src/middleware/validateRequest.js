const { AppError } = require('./errorHandler');

function validateRequest(validatorFn) {
  return function validatorMiddleware(req, _res, next) {
    try {
      const cleaned = validatorFn(req.body || {}, req.query || {}, req.params || {});
      if (cleaned && typeof cleaned === 'object') {
        req.validated = cleaned;
      }
      return next();
    } catch (err) {
      if (err instanceof AppError) return next(err);
      return next(new AppError(400, err.message || 'Invalid request data.'));
    }
  };
}

module.exports = { validateRequest };
