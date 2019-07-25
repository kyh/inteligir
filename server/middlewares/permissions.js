const { rule, shield } = require('graphql-shield');

const rules = {
  isAuthenticatedUser: rule()((parent, args, context) => {
    return !!context.user;
  }),
  isCourseOwner: rule()(async (parent, { id }, context) => {
    const author = await context.prisma.course({ id }).author();
    return context.user.userId === author.id;
  }),
};

module.exports = shield({
  Query: {},
  Mutation: {
    createCourse: rules.isAuthenticatedUser,
    deleteCourse: rules.isCourseOwner,
  },
});
