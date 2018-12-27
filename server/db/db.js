const { Prisma } = require('prisma-binding');
const { fragmentReplacements } = require('@server/db/resolvers');

module.exports = new Prisma({
  typeDefs: 'generated/prisma.graphql',
  endpoint: process.env.PRISMA_ENDPOINT,
  secret: process.env.PRISMA_SECRET,
  fragmentReplacements,
});
