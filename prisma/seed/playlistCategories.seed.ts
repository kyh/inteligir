import { PrismaClient } from '@prisma/client'

export async function seed(prisma: PrismaClient) {
  const popularCategory = await prisma.playlistCategories.create({
    data: {
      name: 'Popular',
      description: 'Top ranked amongst friends',
      createdByRole: 'ADMIN',
    },
  })

  const featuredCategory = await prisma.playlistCategories.create({
    data: {
      name: 'Featured',
      description: 'Hand picked playlists for you',
      createdByRole: 'ADMIN',
    },
  })

  const newCategory = await prisma.playlistCategories.create({
    data: {
      name: 'New & Noteworthy',
      description: 'Started from the bottom now we here',
      createdByRole: 'ADMIN',
    },
  })

  return { popularCategory, featuredCategory, newCategory }
}
