const { objectType } = require('nexus');

const User = objectType({
  name: 'User',
  definition(t) {
    t.model.id();
    t.model.displayName();
    t.model.email();
  },
});

module.exports = {
  User,
};
