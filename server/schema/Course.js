const { objectType } = require('nexus');

const Course = objectType({
  name: 'Course',
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

module.exports = {
  Course,
};
