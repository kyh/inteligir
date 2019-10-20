/* eslint-disable global-require */
const { makeSchema } = require('nexus');
const { nexusPrismaPlugin } = require('nexus-prisma');

const types = {
  ...require('./AuthPayload'),
  ...require('./Mutation'),
  ...require('./Course'),
  ...require('./Query'),
  ...require('./User'),
};

module.exports = makeSchema({
  types,
  plugins: [nexusPrismaPlugin()],
});
