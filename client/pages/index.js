import React from 'react';
import { makeStyles, createStyles } from '@material-ui/core/styles';
import { withApollo } from '@utils/apollo';

import Navigation from '@containers/Navigation';
import { Header, Text, Link, Button, Box, Container } from '@components';

const useStyles = makeStyles((theme) =>
  createStyles({
    hero: {
      backgroundColor: theme.brand.backgroundRed,
      padding: '8% 50% 8% 8%',
      borderRadius: theme.spacing(2),
      backgroundImage: 'url("/assets/featured-bg.png")',
      backgroundSize: 'contain',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: '100% 20px',
    },
  }),
);

function Home() {
  const classes = useStyles();
  return (
    <main>
      <Navigation />
      <Container>
        <Box p={2}>
          <Box className={classes.hero}>
            <Box mb={3}>
              <Header>The best of the web in playlists.</Header>
              <Text>
                Almost all the knowledge is already available on the web. All
                you need is someone to guide you to it.
              </Text>
            </Box>
            <Button
              href="/search"
              variant="outlined"
              color="primary"
              component={Link}
            >
              Start your search
            </Button>
          </Box>
        </Box>
      </Container>
    </main>
  );
}

export default withApollo(Home);
