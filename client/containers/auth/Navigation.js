import React from 'react';
import NProgress from 'nprogress';
import Router from 'next/router';
import { withStyles } from '@material-ui/core/styles';
import { Search } from '@material-ui/icons';
import { Logo, Link, InputBase, InputAdornment } from '@components';

import CurrentUser from './CurrentUser';
import Logout from './Logout';

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
    borderBottom: `1px solid ${theme.brand.borderColor}`,
  },
  nav: {
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    height: theme.spacing(8),
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
  const [values, setValues] = React.useState({
    search: '',
  });

  const handleChange = (prop) => (event) => {
    setValues({ ...values, [prop]: event.target.value });
  };

  return (
    <CurrentUser>
      {({ data: { me } }) => (
        <section className={classes.container}>
          <nav className={classes.nav}>
            <div className="nav-section left">
              <Link href="/courses">Courses</Link>
              <InputBase
                className={classes.searchInput}
                id="search"
                type="text"
                placeholder="Search..."
                value={values.search}
                onChange={handleChange('search')}
                endAdornment={
                  <InputAdornment position="end">
                    <Search color="action" />
                  </InputAdornment>
                }
              />
            </div>
            <div className="nav-section center">
              <Link href="/">
                <Logo />
              </Link>
            </div>
            <div className="nav-section right">
              {!me && (
                <>
                  <Link href="/login">Log in</Link>
                  <Link href="/request_invite">Request an invite</Link>
                </>
              )}
              {me && (
                <>
                  <Logout />
                </>
              )}
            </div>
          </nav>
        </section>
      )}
    </CurrentUser>
  );
}

export default withStyles(styles)(Navigation);
