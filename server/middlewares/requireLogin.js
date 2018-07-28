module.exports = (req, res, next) => {
  if (!req.user) {
    return res.sendError(boom.unauthorized('User not authenticated'));
  }

  next();
};
