import { ApolloServer } from 'apollo-server-express'
import { applyMiddleware } from 'graphql-middleware'
import { keys } from '@server/config/keys'
import { createContext } from '@server/services/context'
import { formatApolloError } from '@server/services/error'
import { schema as baseSchema } from '@server/services/schema'

// Middlewares.
import { permissions } from '@server/middlewares/permissions'

const schema = applyMiddleware(baseSchema, permissions)

export function createApollo() {
  const apolloServer = new ApolloServer({
    schema,
    playground: keys.nodeEnv === 'development',
    debug: keys.nodeEnv === 'development',
    context: createContext,
    formatError: formatApolloError,
  })

  return apolloServer
}
