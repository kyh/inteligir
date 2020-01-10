import 'module-alias/register'
import { Photon } from '@prisma/photon'
import { seed as seedPlaylistCategories } from './seed/playlistCategories.seed'
import { seed as seedUsers } from './seed/users.seed'

const photon = new Photon({
  debug: true,
  log: true,
})

async function main() {
  const playlistCategories = await seedPlaylistCategories(photon)
  await seedUsers(photon, playlistCategories)
}

main().finally(async () => {
  await photon.disconnect()
})
