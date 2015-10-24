import React from 'react';
import { Router, Route } from 'react-router';
import { generateRoute } from 'utils/localized-routes';

export default (
  <Router>
    <Route component={ require('./components/app') }>
      { generateRoute({
        paths: ['/', '/feed'],
        component: require('./components/feed/feed')
      }) }
      { generateRoute({
        paths: ['/groups'],
        component: require('./components/groups/groups')
      }) }
      { generateRoute({
        paths: ['/feed/:id'],
        component: require('./components/feed/post')
      }) }
      { generateRoute({
        paths: ['/profile'],
        component: require('./components/profile/profile')
      }) }
      { generateRoute({
        paths: ['/protected'],
        component: require('./components/protected')
      }) }
      <Route path='*' component={ require('./pages/not-found') } />
    </Route>
  </Router>
);
