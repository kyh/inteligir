import { groups } from './groups.json';

// const simplifyUsers = (collection) => collection
//   .map(({ user, seed }) => ({ ...user, seed }))
//   .map(({ email, name, seed, picture }) => ({ email, name, seed, picture }));

export default function (router) {
  router.get('/groups', async function (ctx) {
    ctx.body = groups;
  });

  // router.get('/users/:seed', async function (ctx) {
  //   const { seed } = ctx.params;
  //   const [ result ] = simplifyUsers(users.filter(user => user.seed === seed));

  //   if (!result) {
  //     ctx.body = { error: { message: 'User not found' } };
  //   } else {
  //     ctx.body = result;
  //   }
  // });
}
