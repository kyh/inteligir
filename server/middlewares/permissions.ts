import { rule, shield } from 'graphql-shield'

const rules = {
  isAuthenticatedUser: rule()((_parent, _args, context) => {
    return !!context.user
  }),
  isPlaylistOwner: rule()(async (_parent, { id }, context) => {
    const author = await context.photon.playlist({ id }).author()
    return context.user.userId === author.id
  }),
}

export const permissions = shield({
  Query: {},
  Mutation: {
    createPlaylist: rules.isAuthenticatedUser,
    deletePlaylist: rules.isPlaylistOwner,
  },
})
