const { rule, shield } = require('graphql-shield');

const rules = {
  isAuthenticatedUser: rule()((parent, args, context) => {
    return !!context.user;
  }),
  isPlaylistOwner: rule()(async (parent, { id }, context) => {
    const author = await context.db.playlist({ id }).author();
    return context.user.userId === author.id;
  }),
};

module.exports = shield({
  Query: {},
  Mutation: {
    createPlaylist: rules.isAuthenticatedUser,
    deletePlaylist: rules.isPlaylistOwner,
  },
});
