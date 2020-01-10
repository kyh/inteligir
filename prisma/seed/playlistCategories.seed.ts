import { Photon } from '@prisma/photon'

export async function seed(photon: Photon) {
  const popularCategory = await photon.playlistCategories.create({
    data: {
      name: 'Popular',
      description: 'Top ranked amongst friends',
      createdByRole: 'ADMIN',
    },
  })

  const featuredCategory = await photon.playlistCategories.create({
    data: {
      name: 'Featured',
      description: 'Hand picked playlists for you',
      createdByRole: 'ADMIN',
    },
  })

  const newCategory = await photon.playlistCategories.create({
    data: {
      name: 'New & Noteworthy',
      description: 'Started from the bottom now we here',
      createdByRole: 'ADMIN',
    },
  })

  return { popularCategory, featuredCategory, newCategory }
}
