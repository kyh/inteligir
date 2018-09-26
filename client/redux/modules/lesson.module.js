/**
 * Lesson module - manage loading, creation, and deletion of lessons.
 */
import axios from 'axios';
import { mapKeys } from 'lodash';
import History from 'util/History';

// Create
export const CREATE_LESSON_REQUEST = 'CREATE_LESSON_REQUEST';
export const CREATE_LESSON_SUCCESS = 'CREATE_LESSON_SUCCESS';
export const CREATE_LESSON_FAIL = 'CREATE_LESSON_FAIL';

export const createLesson = (values, file) => async (dispatch) => {
  dispatch({ type: CREATE_LESSON_REQUEST });
  const uploadConfig = await axios.get('/api/upload');
  await axios.put(uploadConfig.data.data.url, file, {
    headers: { 'Content-Type': 'image/jpeg' },
  });
  const res = await axios.post('/api/lessons', {
    ...values,
    imageUrl: uploadConfig.data.key,
  });
  History.push('/feed');
  dispatch({ type: CREATE_LESSON_SUCCESS, payload: res.data });
};

// Load all
export const LOAD_ALL_LESSONS_REQUEST = 'LOAD_ALL_LESSONS_REQUEST';
export const LOAD_ALL_LESSONS_SUCCESS = 'LOAD_ALL_LESSONS_SUCCESS';
export const LOAD_ALL_LESSONS_FAIL = 'LOAD_ALL_LESSONS_FAIL';

export const loadAllLessons = () => async (dispatch) => {
  dispatch({ type: LOAD_ALL_LESSONS_REQUEST });
  const res = await axios.get('/api/lessons');
  dispatch({ type: LOAD_ALL_LESSONS_SUCCESS, payload: res.data });
};

// Load single
export const LOAD_LESSON_REQUEST = 'LOAD_LESSON_REQUEST';
export const LOAD_LESSON_SUCCESS = 'LOAD_LESSON_SUCCESS';
export const LOAD_LESSON_FAIL = 'LOAD_LESSON_FAIL';

export const loadLesson = (id) => async (dispatch) => {
  dispatch({ type: LOAD_LESSON_REQUEST });
  const res = await axios.get(`/api/lessons/${id}`);
  dispatch({ type: LOAD_LESSON_SUCCESS, payload: res.data });
};

// Reducer
const initialState = {};

const reducerMap = {
  [LOAD_LESSON_SUCCESS]: (state, action) => {
    const lesson = action.payload.data;
    return { ...state, [lesson._id]: lesson };
  },
  [LOAD_ALL_LESSONS_SUCCESS]: (state, action) => {
    return { ...state, ...mapKeys(action.payload.data, '_id') };
  },
};

export default function reducer(state = initialState, action = {}) {
  return reducerMap[action.type]
    ? reducerMap[action.type](state, action)
    : state;
}
