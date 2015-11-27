import React from 'react';
import { Router, Route, IndexRoute } from 'react-router';
import { generateRoute } from 'utils/localized-routes';
import Routes from 'data/routes';

export default (
  <Router>
    <Route path="/" component={ require('./components/app') }>
      <Route path={ Routes.feed } component={ require('./components/feed/feed') }></Route>
      <Route path={ Routes.groups } component={ require('./components/groups/groups') }></Route>
      <Route path={ Routes.profile } component={ require('./components/profile/profile') }></Route>
      <Route path='*' component={ require('./pages/not-found') } />
    </Route>
  </Router>
);
