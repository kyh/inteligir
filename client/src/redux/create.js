import { createStore as _createStore, applyMiddleware, compose } from 'redux';
import reduxThunk from 'redux-thunk';
import { loadingBarMiddleware } from 'react-redux-loading-bar';
import reducers from './reducers';

export default function createStore() {
  // Insert in any middleware we may want to use.
  const middlewares = [
    reduxThunk,
    loadingBarMiddleware({
      promiseTypeSuffixes: ['REQUEST', 'SUCCESS', 'FAIL'],
    }),
  ];

  const finalCreateStore = compose(
    applyMiddleware(...middlewares),
    window.__REDUX_DEVTOOLS_EXTENSION__
      ? window.__REDUX_DEVTOOLS_EXTENSION__()
      : applyMiddleware(),
  )(_createStore);

  const store = finalCreateStore(reducers);

  return store;
}
