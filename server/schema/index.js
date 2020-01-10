/* eslint-disable global-require */
const { makeSchema } = require('nexus');
const { nexusPrismaPlugin } = require('nexus-prisma');
const path = require('path');
const keys = require('@server/config/keys');

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
  shouldGenerateArtifacts: keys.nodeEnv === 'development',
  outputs: {
    schema: path.join(__dirname, 'generated/schema.graphql'),
    typegen: path.join(__dirname, 'generated/nexus.ts'),
  },
});
