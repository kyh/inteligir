/**
 * Auth module - manage user authentication
 */
import axios from 'axios';

// Reset state
export const RESET_REDUX_STORE = 'RESET_REDUX_STORE';

// Load
export const LOAD_USER = 'LOAD_USER';
export const LOAD_USER_SUCCESS = 'LOAD_USER_SUCCESS';
export const LOAD_USER_FAIL = 'LOAD_USER_FAIL';

/**
 * Fetches current logged in user given HTTP cookie
 */
export const loadUser = () => async dispatch => {
  const res = await axios.get('/api/current_user');
  dispatch({ type: LOAD_USER_SUCCESS, payload: res.data });
};

// Reducer
const initialState = null;

const reducerMap = {
  [LOAD_USER_SUCCESS]: (state, action) => {
    return {
      ...action.payload
    };
  }
};

export default function reducer(state = initialState, action = {}) {
  return reducerMap[action.type]
    ? reducerMap[action.type](state, action)
    : state;
}
