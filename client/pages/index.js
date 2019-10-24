import React from 'react';
import PropTypes from 'prop-types';
import { withStyles } from '@material-ui/core/styles';

import { withApollo } from '@utils/apollo';
import { checkLoggedIn } from '@hooks/getCurrentUser';

import Navigation from '@client/containers/Navigation';

const styles = (theme) => ({});

function Home({ classes }) {
  return (
    <main>
      <Navigation />
    </main>
  );
}

Home.propTypes = {
  classes: PropTypes.object.isRequired,
};

Home.getInitialProps = async (context) => {
  const { me } = await checkLoggedIn(context.apolloClient);
  return { me };
};

export default withStyles(styles)(withApollo(Home));
