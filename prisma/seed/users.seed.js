async function seed(photon) {
  const user1 = await photon.users.create({
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
          },
          {
            title: '30 day JavaScript Challenge',
            published: true,
          },
          {
            title: 'Computer Science Fundamentals',
            published: true,
          },
          {
            title: 'Starting with Sketch',
            published: true,
          },
          { title: 'Hottest startups in Thailand', published: true },
          { title: 'Open Source Illustrations', published: true },
        ],
      },
    },
  });

  const user2 = await photon.users.create({
    data: {
      email: 'cathy@inteligir.com',
      displayName: 'Cathy',
      password: '$2b$10$dqyYw5XovLjpmkYNiRDEWuwKaRAvLaG45fnXE5b3KTccKZcRPka2m', // "secret42"
      playlists: {
        create: [
          {
            title: 'Intro to Graphic Design',
            published: true,
          },
          {
            title: 'Storytelling, the basics for a good story',
            published: true,
          },
          { title: 'Preparing to fundraise', published: true },
          { title: 'Finding startup ideas', published: true },
          { title: 'Apps to survive in China', published: true },
        ],
      },
    },
  });

  return [user1, user2];
}

module.exports = seed;
