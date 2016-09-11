import superagent from 'superagent';
import cookie from 'react-cookie';
import config from '../config';

const methods = ['get', 'post', 'put', 'patch', 'del'];

function formatUrl(path) {
  const adjustedPath = path[0] !== '/' ? '/' + path : path;
  if (__SERVER__) {
    const port = config.apiPort ? ':' + config.apiPort : '';
    // Prepend host and port of the API server to the path.
    return config.apiHost + port + adjustedPath;
  }
  // Prepend `/api` to relative URL, to proxy to API server.
  return '/api' + adjustedPath;
}

/*
 * This silly underscore is here to avoid a mysterious "ReferenceError: ApiClient is not defined" error.
 * See Issue #14. https://github.com/erikras/react-redux-universal-hot-example/issues/14
 *
 * Remove it at your own risk.
 */
class _ApiClient {
  constructor(req) {
    methods.forEach((method) =>
      this[method] = (path, { params, data } = {}) => new Promise((resolve, reject) => {
        const request = superagent[method](formatUrl(path));

        const token = cookie.load('token');
        const client = cookie.load('client');
        const uid = cookie.load('uid');

        if (token) {
          request.set('access-token', token);
          request.set('token-type', 'Bearer');
          request.set('uid', uid);
          request.set('client', client);
        }

        if (params) {
          request.query(params);
        }

        if (__SERVER__ && req.get('cookie')) {
          request.set('cookie', req.get('cookie'));
        }

        if (data) {
          request.send(data);
        }

        console.log('API Request:', request.url);

        request.end((err, { body, header } = {}) => {
          if (err) return reject(body || err);
          if (header['access-token']) {
            cookie.save('token', header['access-token']);
            cookie.save('client', header.client);
            cookie.save('uid', header.uid);
          }
          return resolve(body);
        });
      }));
  }
}

const ApiClient = _ApiClient;

export default ApiClient;
