import { schema } from "nexus";

schema.queryType({
  definition(t) {
    /**
     * Authentication.
     */
    t.field("me", {
      type: "User",
      nullable: true,
      resolve: (_parent, _args, context) => {
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
    t.crud.playlists({ filtering: true });
  },
});
