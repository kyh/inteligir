require('module-alias/register');

// Core module requirements.
const path = require('path');
const express = require('express');
const next = require('next');
const cors = require('cors');
const mongoose = require('mongoose');

// Express Middleware.
const cookieSession = require('cookie-session');
const passport = require('passport');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const avatarsMiddleware = require('adorable-avatars').default;
const {
  responseMiddleware,
  catchErrorMiddleware,
} = require('@server/middlewares/route-util');

// Configuration keys.
const keys = require('@server/config/keys');

const PORT = process.env.PORT || 5000;
const IS_DEV = process.env.NODE_ENV !== 'production';

// Set up models and services.
require('express-async-errors');
require('@server/api/users/user.model');
require('@server/api/lessons/lesson.model');
require('@server/services/passport');
require('@server/services/cache');

mongoose.Promise = global.Promise;
mongoose.connect(keys.mongoURI);

/**
 * SSR is done using `Next.js`:
 * https://github.com/zeit/next.js
 */
const app = next({
  dev: IS_DEV,
  dir: path.resolve(__dirname, '../', 'client'),
});
const handle = app.getRequestHandler();

/**
 * To add new API endpoints:
 * 1) First, import the route below
 * 2) Then instantiate the route where it says "Instantiate API routes"
 */
const authRoutes = require('@server/api/users/auth.route');
const uploadRoutes = require('@server/api/upload/upload.route');
const lessonRoutes = require('@server/api/lessons/lesson.route');

app.prepare().then(() => {
  const server = express();

  // Set up app middlewares.
  server.use(
    cors({
      origin: keys.clientUrl,
      credentials: true,
    }),
  );
  server.use(helmet());
  server.use(bodyParser.json());
  server.use(responseMiddleware);
  server.use(
    cookieSession({
      maxAge: 30 * 24 * 60 * 60 * 1000,
      keys: [keys.cookieKey],
    }),
  );
  server.use(passport.initialize());
  server.use(passport.session());
  server.use('/avatars', avatarsMiddleware);

  // Instantiate API routes.
  authRoutes(server);
  uploadRoutes(server);
  lessonRoutes(server);

  // Handle Next.js pages.
  server.get('*', handle);

  // Catch all errors.
  server.use(catchErrorMiddleware);

  server.listen(PORT, () => {
    console.log(`Listening on port`, PORT);
  });
});
