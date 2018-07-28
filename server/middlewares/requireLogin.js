const { sendError } = require('../services/route-util');

module.exports = (req, res, next) => {
  if (!req.user) {
    return sendError(res, 401)(new Error('User not authenticated'));
  }

  next();
};
