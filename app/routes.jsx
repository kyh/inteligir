import React from 'react';
import { Route } from 'react-router';

import { generateRoute } from 'utils/localized-routes';
import { isConnected } from 'utils/routes-hooks';

export default function (flux) { /* eslint react/display-name: 0 */
  return (
    <Route component={ require('./components/app') }>
      { generateRoute({
        paths: [ '/', '/feed' ],
        component: require('./components/feed/feed')
      }) }
      { generateRoute({
        paths: [ '/account' ],
        component: require('./pages/account'),
        onEnter: isConnected(flux)
      }) }
      { generateRoute({
        paths: [ '/guides' ],
        component: require('./components/groups/guides')
      }) }
      { generateRoute({
        paths: [ '/profile/:seed' ],
        component: require('./components/profile/profile')
      }) }
      { generateRoute({
        paths: [ '/login' ],
        component: require('./pages/login')
      }) }
      <Route path='*' component={ require('./pages/not-found') } />
    </Route>
  );
}
