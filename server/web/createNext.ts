/**
 * Next.js app which handles SSR of React application.
 */
import next from 'next'
import { keys } from '@server/config/keys'

export function createNext() {
  const app = next({
    dev: keys.nodeEnv !== 'production',
  })
  const handle = app.getRequestHandler()

  return { nextApp: app, handle }
}
