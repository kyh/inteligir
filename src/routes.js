import React from 'react';
import {IndexRoute, Route} from 'react-router';
import { isLoaded as isAuthLoaded, load as loadAuth } from 'redux/modules/auth';
import {
    App,
    Home,
    About,
    Login,
    LoginSuccess,
    NotFound,
  } from 'containers';

export default (store) => {
  const checkUser = (callback) => {
    function checkAuth() {
      const { auth: { user }} = store.getState();
      return callback(user);
    }

    if (!isAuthLoaded(store.getState())) {
      store.dispatch(loadAuth()).then(checkAuth);
    } else {
      checkAuth();
    }
  };

  // Routes that require user to be logged in
  const requireLogin = (nextState, replace, cb) => {
    return checkUser((user) => {
      if (!user) {
        // oops, not logged in, so can't be here!
        replace('/');
      }
      cb();
    });
  };

  // Check if user is already logged in, redirect to 'feed' if they are
  const redirectIfLoggedIn = (nextState, replace, cb) => {
    return checkUser((user) => {
      if (user) {
        // user already logged in
        replace('/feed');
      }
      cb();
    });
  };

  /**
   * Please keep routes in alphabetical order
   */
  return (
    <Route path="/" component={App}>
      { /* Home (main) route */ }
      <Route onEnter={redirectIfLoggedIn}>
        <IndexRoute component={Home}/>
        <Route path="login" component={Login}/>
      </Route>

      { /* Routes requiring login */ }
      <Route onEnter={requireLogin}>
        <Route path="loginSuccess" component={LoginSuccess}/>
      </Route>

      { /* Routes */ }
      <Route path="about" component={About}/>

      { /* Catch all route */ }
      <Route path="*" component={NotFound} status={404} />
    </Route>
  );
};
