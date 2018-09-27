require('module-alias/register');

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const cookieSession = require('cookie-session');
const passport = require('passport');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const keys = require('config/keys');
const {
  responseMiddleware,
  catchErrorMiddleware,
} = require('middlewares/route-util');

// Set up models and services.
require('express-async-errors');
require('api/users/user.model');
require('api/lessons/lesson.model');
require('services/passport');
require('services/cache');

mongoose.Promise = global.Promise;
mongoose.connect(keys.mongoURI);

const app = express();

// Set up app middlewares.
app.use(
  cors({
    origin: keys.clientUrl,
    credentials: true,
  }),
);
app.use(helmet());
app.use(bodyParser.json());
app.use(responseMiddleware);
app.use(
  cookieSession({
    maxAge: 30 * 24 * 60 * 60 * 1000,
    keys: [keys.cookieKey],
  }),
);
app.use(passport.initialize());
app.use(passport.session());

// API routes.
require('api/users/auth.route')(app);
require('api/upload/upload.route')(app);
require('api/lessons/lesson.route')(app);

// Catch all errors.
app.use(catchErrorMiddleware);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Listening on port`, PORT);
});
