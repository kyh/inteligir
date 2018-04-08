if (process.env.NODE_ENV === 'ci') {
  module.exports = require('./ci');
} else {
  module.exports = require('./app-keys');
}
