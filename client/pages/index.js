import React from 'react';
import { withApollo } from '@utils/apollo';

import Navigation from '@containers/Navigation';
import HeroSection from '@containers/HeroSection';
import FeaturedPlaylistCollection from '@containers/FeaturedPlaylistCollection';
import PlaylistCollection from '@containers/PlaylistCollection';
import NewsletterSignup from '@containers/NewsletterSignup';
import { Link, Button, Box, Container } from '@components';

const playlists = [
  { title: 'Preparing to fundraise' },
  { title: 'Finding startup ideas' },
  { title: 'Apps to survive in China' },
  { title: 'Hottest startups in Thailand' },
  { title: 'Open Source Illustrations' },
];

const featuredPlaylist = {
  title: 'The Python Planner: Beginner coding for 30 minutes a day',
};

const popularSection = {
  title: 'Popular',
  playlists: [
    {
      title: '30 day JavaScript Challenge',
    },
    {
      title: 'Intro to Graphic Design',
    },
  ],
};

const newSection = {
  title: 'New & Noteworthy',
  playlists: [
    {
      title: 'Storytelling, the basics for a good story',
    },
    {
      title: 'Computer Science Fundamentals',
    },
    {
      title: 'Starting with Sketch',
    },
  ],
};

function Home() {
  return (
    <main>
      <Navigation />
      <Container>
        <HeroSection
          title="The best of the web in playlists."
          description="Almost all the knowledge is already available on the web. All you
              need is someone to guide you to it."
          backgroundImage="/assets/hero-bg.svg"
          backgroundColor="#E8F4F4"
          renderCta={() => (
            <Button
              href="/search"
              variant="outlined"
              color="primary"
              component={Link}
            >
              Find a great playlist
            </Button>
          )}
        />
        <FeaturedPlaylistCollection
          featuredPlaylist={featuredPlaylist}
          tabs={[popularSection, newSection]}
        />
      </Container>
      <Box mb={4} mt={4}>
        <NewsletterSignup />
      </Box>
      <Container>
        <Box mb={4}>
          <PlaylistCollection
            collectionTitle="Recommended for you"
            playlists={playlists}
          />
        </Box>
        <Box mb={4}>
          <PlaylistCollection
            collectionTitle="Fresh Favorites"
            playlists={playlists}
          />
        </Box>
      </Container>
    </main>
  );
}

export default withApollo(Home);
