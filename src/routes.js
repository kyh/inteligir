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
  const checkAuthOnEnter = (redirect, isUserLoggedIn) => (nextState, replace, cb) => {
    function checkUser() {
      const { auth: { user }} = store.getState();
      if ((isUserLoggedIn && user) || (!isUserLoggedIn && !user)) {
        // oops, not logged in, so can't be here!
        replace(redirect);
      }
      cb();
    }

    if (!isAuthLoaded(store.getState())) {
      store.dispatch(loadAuth()).then(checkUser, checkUser);
    } else {
      checkUser();
    }
  };

  // Routes that require user to be logged in
  const requireLogin = checkAuthOnEnter('/', false);

  // Check if user is already logged in, redirect to 'feed' if they are
  const redirectIfLoggedIn = checkAuthOnEnter('/feed', true);

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
