const { idArg, queryType, stringArg } = require('nexus');

const Query = queryType({
  definition(t) {
    t.crud.course();
    t.crud.courses();

    t.field('me', {
      type: 'User',
      resolve: (parent, args, context) => {
        return context.db.users.findOne({
          where: {
            id: context.user.userId,
          },
        });
      },
    });

    t.list.field('feed', {
      type: 'Course',
      resolve: (parent, args, context) => {
        return context.db.courses.findMany({
          where: { published: true },
        });
      },
    });

    t.list.field('filterCourses', {
      type: 'Course',
      args: {
        searchString: stringArg({ nullable: true }),
      },
      resolve: (parent, { searchString }, context) => {
        return context.db.courses.findMany({
          where: {
            OR: [
              {
                title: {
                  contains: searchString,
                },
              },
              {
                description: {
                  contains: searchString,
                },
              },
            ],
          },
        });
      },
    });

    t.field('course', {
      type: 'Course',
      nullable: true,
      args: { id: idArg() },
      resolve: (parent, { id }, context) => {
        return context.db.courses.findOne({
          where: {
            id,
          },
        });
      },
    });
  },
});

module.exports = {
  Query,
};
