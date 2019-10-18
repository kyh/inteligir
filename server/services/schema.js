const { makeSchema } = require('nexus');
const { nexusPrismaPlugin } = require('nexus-prisma');
const types = require('@server/types');

module.exports = makeSchema({
  types,
  plugins: [nexusPrismaPlugin()],
});
