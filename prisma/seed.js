require('module-alias/register');

const { Photon } = require('@generated/photon');
const photon = new Photon();

async function main() {
  const user = await photon.users.create({
    data: {
      email: 'kai@inteligir.com',
      username: 'Alice',
      password: '$2b$10$dqyYw5XovLjpmkYNiRDEWuwKaRAvLaG45fnXE5b3KTccKZcRPka2m', // "secret42"
      courses: {
        create: {
          title: 'How to contribute to Inteligir',
          description: 'Step by step guide on how Inteligir was built',
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
