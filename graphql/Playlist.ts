import { schema } from "nexus";

schema.objectType({
  name: "Playlist",
  definition(t) {
    t.model.id();
    t.model.createdAt();
    t.model.updatedAt();
    t.model.published();
    t.model.title();
    t.model.description();
    t.model.author();
  },
});
