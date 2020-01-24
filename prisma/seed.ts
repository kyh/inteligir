import 'tsconfig-paths/register'
import { PrismaClient } from '@prisma/client'
import { seed as seedPlaylistCategories } from './seed/playlistCategories.seed'
import { seed as seedUsers } from './seed/users.seed'

const prisma = new PrismaClient({
  debug: true,
  log: true,
})

async function main() {
  const playlistCategories = await seedPlaylistCategories(prisma)
  await seedUsers(prisma, playlistCategories)
}

main().finally(async () => {
  await prisma.disconnect()
})
