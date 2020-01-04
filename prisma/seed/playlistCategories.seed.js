async function seed(photon) {
  const popularCategory = await photon.playlistCategories.create({
    data: {
      name: 'Popular',
      description: 'Top ranked amongst friends',
    },
  });

  const featuredCategory = await photon.playlistCategories.create({
    data: {
      name: 'Featured',
      description: 'Hand picked playlists for you',
    },
  });

  const newCategory = await photon.playlistCategories.create({
    data: {
      name: 'New & Noteworthy',
      description: 'Started from the bottom now we here',
    },
  });

  return { popularCategory, featuredCategory, newCategory };
}

module.exports = seed;
