import React from 'react';
import NProgress from 'nprogress';
import Router from 'next/router';
import { useApolloClient } from '@apollo/react-hooks';
import { withStyles } from '@material-ui/core/styles';
import { KeyboardArrowDown } from '@material-ui/icons';

import { useGetCurrentUser } from '@hooks/getCurrentUser';
import { useLogout } from '@hooks/logout';

import CourseSearchInput from '@containers/CourseSearchInput';
import { Logo, Link } from '@components';

Router.onRouteChangeStart = () => {
  NProgress.start();
};
Router.onRouteChangeComplete = () => {
  NProgress.done();
};

Router.onRouteChangeError = () => {
  NProgress.done();
};

const styles = (theme) => ({
  container: {
    padding: `0 ${theme.spacing(3)}px`,
  },
  nav: {
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    height: theme.spacing(9),
    maxWidth: theme.brand.maxWidth,
    margin: '0 auto',
    '& > .nav-section': {
      display: 'flex',
    },
    '& > .left': {
      width: '50%',
      justifyContent: 'flex-start',
    },
    '& > .right': {
      width: '50%',
      justifyContent: 'flex-end',
    },
    '& a, & button': {
      fontWeight: 700,
      marginRight: theme.spacing(3),
      border: 'none',
      display: 'flex',
      alignItems: 'center',
      '&:hover': {
        color: theme.palette.primary.dark,
      },
      '&:last-child': {
        marginRight: 0,
      },
    },
  },
  searchInput: {
    fontSize: '16px',
    background: '#f0f1f2',
    height: '45px',
    paddingLeft: theme.spacing(2),
    paddingRight: theme.spacing(1),
    borderRadius: '4px',
    alignSelf: 'center',
  },
});

function Navigation({ classes }) {
  const apolloClient = useApolloClient();
  const [logout] = useLogout();
  const { loading, error, data } = useGetCurrentUser();
  if (loading || error) return null;

  const handleLogout = () => {
    logout().then(() => apolloClient.resetStore());
  };

  return (
    <section className={classes.container}>
      <nav className={classes.nav}>
        <div className="nav-section left">
          <Link href="/courses">
            Browse
            <KeyboardArrowDown />
          </Link>
          <CourseSearchInput />
        </div>
        <div className="nav-section center">
          <Link href="/">
            <Logo />
          </Link>
        </div>
        <div className="nav-section right">
          {data.me ? (
            <Link href="/" onClick={handleLogout}>
              Logout
            </Link>
          ) : (
            <>
              <Link href="/login">Log in</Link>
              <Link href="/signup">Request an invite</Link>
            </>
          )}
        </div>
      </nav>
    </section>
  );
}

export default withStyles(styles)(Navigation);
