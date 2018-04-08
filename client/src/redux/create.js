import { createStore as _createStore, applyMiddleware, compose } from 'redux';
import createMiddleware from './middleware/client-middleware';
import reducers from './reducers';

export default function createStore() {
  // Insert in any middleware we may want to use.
  const middlewares = [createMiddleware()];

  const finalCreateStore = compose(
    applyMiddleware(...middlewares),
    window.__REDUX_DEVTOOLS_EXTENSION__
      ? window.__REDUX_DEVTOOLS_EXTENSION__()
      : applyMiddleware()
  )(_createStore);

  const store = finalCreateStore(reducers);

  return store;
}
