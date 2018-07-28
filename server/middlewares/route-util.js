function sendSuccess(data, message) {
  this.status(200).json({ type: 'success', data, message });
}

function sendError(boomError) {
  // TODO: Check if error is a boom object.
  if (boomError.isServer) {
    console.log(boomError);
  }
  return this.status(boomError.output.statusCode).json(
    boomError.output.payload,
  );
}

module.exports = (req, res, next) => {
  res.sendSuccess = sendSuccess;
  res.sendError = sendError;
  next();
};
