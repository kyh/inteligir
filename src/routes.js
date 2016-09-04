import React from 'react';
import {IndexRoute, Route} from 'react-router';
import { isLoaded as isAuthLoaded, load as loadAuth } from 'redux/modules/auth';
import {
    App,
    Home,
    About,
    Login,
    Feed,
    Groups,
    Profile,
    NewPost,
    NotFound,
  } from 'containers';

export default (store) => {
  // Routes that require user to be logged in
  const requireLogin = (nextState, replace, cb) => {
    function checkAuth() {
      const { auth: { user }} = store.getState();
      if (!user) {
        // oops, not logged in, so can't be here!
        replace('/');
      }
      cb();
    }

    if (!isAuthLoaded(store.getState())) {
      store.dispatch(loadAuth()).then(checkAuth, checkAuth);
    } else {
      checkAuth();
    }
  };

  // Check if user is already logged in, redirect to 'feed' if they are
  const redirectIfLoggedIn = (nextState, replace, cb) => {
    function checkAuth() {
      const { auth: { user }} = store.getState();
      if (user) {
        // Already logged in!
        replace('/feed');
      }
      cb();
    }

    if (isAuthLoaded(store.getState())) {
      checkAuth();
    } else {
      store.dispatch(loadAuth()).then(checkAuth, checkAuth);
    }
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
        <Route path="feed" component={Feed}/>
        <Route path="groups" component={Groups}/>
        <Route path="new-post" component={NewPost}/>
        <Route path="profile" component={Profile}/>
      </Route>

      { /* Routes */ }
      <Route path="about" component={About}/>

      { /* Catch all route */ }
      <Route path="*" component={NotFound} status={404} />
    </Route>
  );
};
