const LOAD = 'LOAD_POSTS';
const LOAD_SUCCESS = 'LOAD_POSTS_SUCCESS';
const LOAD_FAIL = 'LOAD_POSTS_FAIL';
const CREATE_POST = 'CREATE_POST';
const CREATE_POST_SUCCESS = 'CREATE_POST_SUCCESS';
const CREATE_POST_FAIL = 'CREATE_POST_FAIL';

const initialState = {
  loaded: false
};

export default function posts(state = initialState, action = {}) {
  switch (action.type) {
    case LOAD:
      return {
        ...state,
        loading: true
      };
    case LOAD_SUCCESS:
      return {
        ...state,
        loading: false,
        loaded: true,
        data: action.result
      };
    case LOAD_FAIL:
      return {
        ...state,
        loading: false,
        loaded: false,
        error: action.error
      };
    case CREATE_POST:
      return {
        ...state,
        postError: null,
        loading: true
      };
    case CREATE_POST_SUCCESS:
      return {
        ...state,
        loading: false
      };
    case CREATE_POST_FAIL:
      return {
        ...state,
        loading: false,
        loginError: action.error
      };
    default:
      return state;
  }
}

export function isLoaded(globalState) {
  return globalState.posts && globalState.posts.loaded;
}

export function load() {
  return {
    types: [LOAD, LOAD_SUCCESS, LOAD_FAIL],
    promise: (client) => client.get('/feed')
  };
}

export function createPost(title, content) {
  return {
    types: [CREATE_POST, CREATE_POST_SUCCESS, CREATE_POST_FAIL],
    promise: (client) => client.post('/api/v1/posts/new', {
      data: { title, content }
    })
  };
}
