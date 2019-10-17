require('module-alias/register');

const { Photon } = require('@generated/photon');
const photon = new Photon();

async function main() {
  const user = await photon.users.create({
    data: {
      email: 'alice@prisma.io',
      name: 'Alice',
      password: '$2b$10$dqyYw5XovLjpmkYNiRDEWuwKaRAvLaG45fnXE5b3KTccKZcRPka2m', // "secret42"
      posts: {
        create: {
          title: 'Watch the talks from Prisma Day 2019',
          content: 'https://www.prisma.io/blog/z11sg6ipb3i1/',
          published: true,
        },
      },
    },
  });

  console.log({ user });
}

main().finally(async () => {
  await photon.disconnect();
});
