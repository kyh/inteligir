import { PrismaClient } from '@prisma/client'
import { seed as seedPlaylistCategories } from './seed/playlistCategories.seed'
import { seed as seedUsers } from './seed/users.seed'

const prisma = new PrismaClient()

async function main() {
  const playlistCategories = await seedPlaylistCategories(prisma)
  await seedUsers(prisma, playlistCategories)
}

main().finally(async () => {
  await prisma.disconnect()
})
