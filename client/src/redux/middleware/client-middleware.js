/**
 * Converts ApiClient into a middleware. Taken from
 * https://redux.js.org/recipes/reducing-boilerplate
 *
 * Expected action object:
  {
    types: [REQUEST_ACTION, SUCCESS_ACTION, FAILURE_ACTION],
    callApi: (client) => client[METHOD],
    shouldCallApi: () => <Boolean>
  }
 *
 * Action params:
 * types: An array of 3 string types that represent the action, action success, and action failure
 * for a set of action creators.
 *
 * callApi: Define a rest endpoint to hit, should return a promise that resolves with the api
 * response.
 *
 * shouldCallApi: shouldCallApi allows you to define whether or not the action should be dispatched.
 * E.g. `shouldCallApi: () => !state.profile.isLoading && !state.profile.isLoaded` will only
 * dispatch the action if the profile is not loading and hasn't been loaded before.
 *
 * ...rest:
 * You can pass along any other data back to the reducer.
 *
 * @return {func} - returns redux middleware
 */
export default function clientMiddleware() {
  return ({ dispatch, getState }) => next => action => {
    if (typeof action === 'function') {
      return action(dispatch, getState);
    }

    const { types, callApi, shouldCallApi = () => true, ...rest } = action;

    if (!types || !callApi) {
      return next(action);
    }

    if (
      !Array.isArray(types) ||
      types.length !== 3 ||
      !types.every(type => typeof type === 'string')
    ) {
      throw new Error('Expected an array of three string types.');
    }

    if (!shouldCallApi(getState())) {
      return Promise.resolve();
    }

    const [REQUEST, SUCCESS, FAILURE] = types;
    next({ ...rest, type: REQUEST });

    const actionPromise = callApi();
    actionPromise
      .then(
        result => next({ ...rest, result, type: SUCCESS }),
        error => next({ ...rest, error, type: FAILURE })
      )
      .catch(error => {
        console.error('MIDDLEWARE ERROR:', error);
        next({ ...rest, error, type: FAILURE });
      });

    return actionPromise;
  };
}
