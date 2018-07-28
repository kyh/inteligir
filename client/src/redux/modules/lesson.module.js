/**
 * Lesson module - manage loading, creation, and deletion of lessons.
 */
import axios from 'axios';
import { mapKeys } from 'lodash';

// Create
export const CREATE_LESSON = 'CREATE_LESSON';
export const CREATE_LESSON_SUCCESS = 'CREATE_LESSON_SUCCESS';
export const CREATE_LESSON_FAIL = 'CREATE_LESSON_FAIL';

export const createLesson = (values, history) => async (dispatch) => {
  const res = await axios.post('/api/lessons', values);
  history.push('/feed');
  dispatch({ type: CREATE_LESSON_SUCCESS, payload: res.data });
};

// Load all
export const LOAD_ALL_LESSONS = 'LOAD_ALL_LESSONS';
export const LOAD_ALL_LESSONS_SUCCESS = 'LOAD_ALL_LESSONS_SUCCESS';
export const LOAD_ALL_LESSONS_FAIL = 'LOAD_ALL_LESSONS_FAIL';

export const loadAllLessons = () => async (dispatch) => {
  const res = await axios.get('/api/lessons');
  dispatch({ type: LOAD_ALL_LESSONS_SUCCESS, payload: res.data });
};

// Load single
export const LOAD_LESSON = 'LOAD_LESSON';
export const LOAD_LESSON_SUCCESS = 'LOAD_LESSON_SUCCESS';
export const LOAD_LESSON_FAIL = 'LOAD_LESSON_FAIL';

export const loadLesson = (id) => async (dispatch) => {
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
