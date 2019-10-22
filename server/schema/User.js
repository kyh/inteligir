const { objectType } = require('nexus');

const User = objectType({
  name: 'User',
  definition(t) {
    t.model.id();
    t.model.email();
    t.model.displayName();
  },
});

module.exports = {
  User,
};
