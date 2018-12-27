const { extractFragmentReplacements } = require('prisma-binding');

const Query = require('@server/resolvers/Query');
const Mutation = require('@server/resolvers/Mutation');
const Subscription = require('@server/resolvers/Subscription');
const User = require('@server/resolvers/User');

const resolvers = {
  Query,
  Mutation,
  // Subscription,
  User,
};

const fragmentReplacements = extractFragmentReplacements(resolvers);

module.exports = { resolvers, fragmentReplacements };
