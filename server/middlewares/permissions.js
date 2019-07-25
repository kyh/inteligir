const { rule, shield } = require('graphql-shield');

const rules = {
  isAuthenticatedUser: rule()((parent, args, context) => {
    return !!context.user;
  }),
  isListOwner: rule()(async (parent, { id }, context) => {
    const author = await context.prisma.list({ id }).author();
    return context.user.userId === author.id;
  }),
};

module.exports = shield({
  Query: {},
  Mutation: {
    createList: rules.isAuthenticatedUser,
    deleteList: rules.isListOwner,
  },
});
