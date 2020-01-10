import 'module-alias/register'
/**
 * Inteligir web server is built using 3 main libraries:
 * Express: Node http server.
 * - https://github.com/expressjs/express
 *
 * Next.js: React web app SSR.
 * - https://github.com/zeit/next.js
 *
 * GraphQl Apollo server: server graphql endpoints.
 * - https://github.com/apollographql/apollo-server
 *
 * This is the entrypoint to the Inteligir backend. See files under `/web`
 * on the creation of each app.
 */
import { keys } from '@server/config/keys'
import { createExpress } from '@server/web/createExpress'
import { createNext } from '@server/web/createNext'
import { createApollo } from '@server/web/createApollo'

const app = createExpress()
const server = createApollo()
const { nextApp, handle } = createNext()

nextApp.prepare().then(() => {
  // Create `/graphql` endpoints.
  server.applyMiddleware({ app })

  // Handle Next.js pages.
  app.get('/l/:id', (req, res) => {
    return nextApp.render(req, res, '/list', { id: req.params.id })
  })

  app.get('*', (req, res, nxt) => {
    return handle(req, res, nxt)
  })

  app.listen({ port: keys.port }, () => {
    console.log(`Server started on port: ${keys.port}`)
  })
})
