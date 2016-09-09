import { combineReducers } from 'redux';
import { routerReducer } from 'react-router-redux';
import {reducer as reduxAsyncConnect} from 'redux-connect';

import auth from './auth';
import posts from './posts';
import {reducer as form} from 'redux-form';

export default combineReducers({
  routing: routerReducer,
  reduxAsyncConnect,
  auth,
  posts,
  form
});
