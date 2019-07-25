import React from 'react';
import PropTypes from 'prop-types';
import { withStyles } from '@material-ui/core/styles';

import Navigation from '@client/containers/auth/Navigation';

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

export default withStyles(styles)(Home);
