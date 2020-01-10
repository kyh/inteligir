/**
 * Node http server built with Express.
 */
import express from 'express'

// Middlewares.
import avatarsMiddleware from 'adorable-avatars'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'

export function createExpress() {
  const app = express()

  app.use(helmet())
  app.use(cookieParser())
  app.use('/avatars', avatarsMiddleware)

  return app
}
