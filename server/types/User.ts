const { objectType } = require('nexus')

export const User = objectType({
  name: 'User',
  definition(t) {
    t.model.id()
    t.model.email()
    t.model.displayName()
  },
})
