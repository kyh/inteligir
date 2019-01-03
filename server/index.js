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
const helmet = require('helmet');
const passport = require('passport');

/**
 * Database: Postgres database with Prisma ORM for GraphQl mapping.
 * - https://github.com/prisma/prisma
 */
const { prisma } = require('@server/db/generated/prisma-client');
const { resolvers } = require('@server/resolvers');
const { permissions } = require('@server/permissions');

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
    typeDefs: './db/schema.graphql',
    resolvers,
    middlewares: [permissions],
    context(request) {
      return { pubsub, prisma, ...request };
    },
  });

  // Set up express middlewares.
  server.express.use(helmet());
  server.express.use(passport.initialize());
  server.express.use(passport.session());
  server.express.use('/avatars', avatarsMiddleware);

  // Handle Next.js pages.
  server.express.get('*', handle);

  server.start({ port: PORT }, () => {
    console.log(`Listening on port`, PORT);
  });
});
