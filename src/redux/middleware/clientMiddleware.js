/**
 * Converts ApiClient into a middleware
 * Expected action object:
  {
    types: [REQUEST_ACTION, SUCCESS_ACTION, FAILURE_ACTION],
    onSuccess: SUCCESS_CALLBACK,
    onError: FAILURE_CALLBACK,
    promise: (client) => client[METHOD]
  }
 *
 * @param {ApiClient}
 * @return {func} - returns redux middleware
 */

export default function clientMiddleware(client) {
  return ({ dispatch, getState }) => {
    return next => action => {
      if (typeof action === 'function') {
        return action(dispatch, getState);
      }

      const {
        promise,
        types,
        onSuccess = () => {},
        onError = () => {},
        ...rest
      } = action;

      if (!promise) {
        return next(action);
      }

      const [REQUEST, SUCCESS, FAILURE] = types;
      next({ ...rest, type: REQUEST });

      const actionPromise = promise(client);
      actionPromise.then(
        (result) => {
          onSuccess(dispatch, result);
          next({ ...rest, result, type: SUCCESS });
        },
        (error) => {
          onError(dispatch, error);
          next({ ...rest, error, type: FAILURE });
        }
      ).catch((error) => {
        console.error('MIDDLEWARE ERROR:', error);
        next({ ...rest, error, type: FAILURE });
      });

      return actionPromise;
    };
  };
}
