import 'styles/variables.css';
import 'styles/global.css';
import 'styles/app.css';
import 'styles/fonts/fonts.css';

import React from 'react';
import ReactDOM from 'react-dom';
import axios from 'axios';
import { Provider } from 'react-redux';

import createStore from './redux/create';
import App from './routes/App';

window.axios = axios;

const store = createStore();

ReactDOM.render(
  <Provider store={store}>
    <App />
  </Provider>,
  document.querySelector('#root'),
);
