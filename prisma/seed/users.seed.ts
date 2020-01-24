import { PrismaClient } from '@prisma/client'

export async function seed(
  prisma: PrismaClient,
  { popularCategory, featuredCategory, newCategory }: any,
) {
  const user1 = await prisma.users.create({
    data: {
      email: 'kai@inteligir.com',
      displayName: 'Kai',
      password: '$2b$10$dqyYw5XovLjpmkYNiRDEWuwKaRAvLaG45fnXE5b3KTccKZcRPka2m', // "secret42"
      playlists: {
        create: [
          {
            title: 'How to contribute to Inteligir',
            description: 'Step by step guide on how Inteligir was built',
            published: true,
          },
          {
            title: 'The Python Planner: Beginner coding for 30 minutes a day',
            published: true,
            categories: {
              connect: {
                id: featuredCategory.id,
              },
            },
          },
          {
            title: '30 day JavaScript Challenge',
            published: true,
            categories: {
              connect: {
                id: popularCategory.id,
              },
            },
          },
          {
            title: 'Computer Science Fundamentals',
            published: true,
            categories: {
              connect: {
                id: newCategory.id,
              },
            },
          },
          {
            title: 'Starting with Sketch',
            published: true,
            categories: {
              connect: {
                id: newCategory.id,
              },
            },
          },
          { title: 'Hottest startups in Thailand', published: true },
          { title: 'Open Source Illustrations', published: true },
        ],
      },
    },
  })

  const user2 = await prisma.users.create({
    data: {
      email: 'cathy@inteligir.com',
      displayName: 'Cathy',
      password: '$2b$10$dqyYw5XovLjpmkYNiRDEWuwKaRAvLaG45fnXE5b3KTccKZcRPka2m', // "secret42"
      playlists: {
        create: [
          {
            title: 'Intro to Graphic Design',
            published: true,
            categories: {
              connect: {
                id: popularCategory.id,
              },
            },
          },
          {
            title: 'Storytelling, the basics for a good story',
            published: true,
            categories: {
              connect: {
                id: newCategory.id,
              },
            },
          },
          { title: 'Preparing to fundraise', published: true },
          { title: 'Finding startup ideas', published: true },
          { title: 'Apps to survive in China', published: true },
        ],
      },
    },
  })

  return [user1, user2]
}
