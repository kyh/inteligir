/* eslint-disable global-require */
const { makeSchema } = require('nexus');
const { nexusPrismaPlugin } = require('nexus-prisma');

const types = {
  ...require('./Query'),
  ...require('./Mutation'),
  ...require('./AuthPayload'),
  ...require('./Playlist'),
  ...require('./User'),
};

module.exports = makeSchema({
  types,
  plugins: [nexusPrismaPlugin()],
});
