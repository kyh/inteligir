/* eslint-disable global-require */
module.exports = {
  ...require('./AuthPayload'),
  ...require('./Mutation'),
  ...require('./Course'),
  ...require('./Query'),
  ...require('./User'),
};
