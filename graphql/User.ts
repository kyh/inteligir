import { schema } from "nexus";

schema.objectType({
  name: "User",
  definition(t) {
    t.string("id");
    t.string("name");
    t.string("email");
    t.list.field("playlist", {
      type: "Playlist",
      resolve: (parent, _args, context) =>
        context.prisma.user
          .findOne({
            where: { id: Number(parent.id) },
          })
          .playlists(),
    });
  },
});
