require('module-alias/register');

const { Photon } = require('@prisma/photon');
const seedPlaylistCategories = require('./seed/playlistCategories.seed');
const seedUsers = require('./seed/users.seed');

const photon = new Photon({
  debug: true,
  log: true,
});

async function main() {
  await seedPlaylistCategories(photon);
  await seedUsers(photon);
}

main().finally(async () => {
  await photon.disconnect();
});
