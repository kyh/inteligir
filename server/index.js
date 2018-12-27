require('module-alias/register');

/**
 * Web server: GraphQl express server bundled by `GraphQl Yoga`.
 * - https://github.com/prisma/graphql-yoga
 */
const next = require('next');
const path = require('path');
const { GraphQLServer, PubSub } = require('graphql-yoga');

/**
 * Express Middlewares.
 */
const avatarsMiddleware = require('adorable-avatars').default;
const bodyParser = require('body-parser');
const cookieSession = require('cookie-session');
const cors = require('cors');
const helmet = require('helmet');
const passport = require('passport');

/**
 * Configuration keys:
 * See `docs/environment_variables.md` for server environment configuration.
 */
const keys = require('@server/config/keys');

/**
 * Database: Postgres database with Prisma ORM for GraphQl mapping.
 * - https://github.com/prisma/prisma
 */
const { resolvers, fragmentReplacements } = require('@server/resolvers');
const db = require('@server/db/db');

const PORT = process.env.PORT || 5000;
const IS_DEV = process.env.NODE_ENV !== 'production';

// Set up services.
require('express-async-errors');
require('@server/services/passport');

/**
 * SSR is done using `Next.js`:
 * - https://github.com/zeit/next.js
 */
const app = next({
  dev: IS_DEV,
  dir: path.resolve(__dirname, '../', 'client'),
});
const handle = app.getRequestHandler();

app.prepare().then(() => {
  // Handle GraphQl Subscriptions.
  const pubsub = new PubSub();
  // Start up GraphQl web server.
  const server = new GraphQLServer({
    typeDefs: './schema/schema.graphql',
    resolvers,
    context(request) {
      return { pubsub, db, request };
    },
    fragmentReplacements,
  });

  // Set up express middlewares.
  server.express.use(
    cors({
      origin: keys.clientUrl,
      credentials: true,
    }),
  );
  server.express.use(helmet());
  server.express.use(bodyParser.json());
  server.express.use(
    cookieSession({
      maxAge: 30 * 24 * 60 * 60 * 1000,
      keys: [keys.cookieKey],
    }),
  );
  server.express.use(passport.initialize());
  server.express.use(passport.session());
  server.express.use('/avatars', avatarsMiddleware);

  // Handle Next.js pages.
  server.express.get('*', handle);

  server.start({ port: PORT }, () => {
    console.log(`Listening on port`, PORT);
  });
});
