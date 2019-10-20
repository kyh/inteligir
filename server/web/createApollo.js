const { ApolloServer } = require('apollo-server-express');
const keys = require('@server/config/keys');
const db = require('@server/services/db');
const schema = require('@server/schema');
const { parseRequest, getUser } = require('@server/services/authentication');

function createApollo() {
  const apolloServer = new ApolloServer({
    schema,
    playground: keys.nodeEnv === 'development',
    debug: keys.nodeEnv === 'development',
    cors: { credentials: true },
    context: ({ req, res }) => {
      const token = parseRequest(req);
      return {
        db,
        photon: db,
        request: req,
        response: res,
        user: getUser(token),
      };
    },
    formatError: (error) => {
      if (keys.nodeEnv === 'development') {
        console.log(error);
      }
      return error;
    },
  });

  return apolloServer;
}

module.exports = createApollo;
