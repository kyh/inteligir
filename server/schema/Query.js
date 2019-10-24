const { queryType } = require('nexus');

const Query = queryType({
  definition(t) {
    /**
     * Authentication.
     */
    t.field('me', {
      type: 'User',
      nullable: true,
      resolve: (parent, args, context) => {
        if (!context.user) return null;
        return context.db.users.findOne({
          where: {
            id: context.user.userId,
          },
        });
      },
    });

    /**
     * Playlists
     */
    t.crud.playlist();
    t.crud.playlists();
  },
});

module.exports = {
  Query,
};
