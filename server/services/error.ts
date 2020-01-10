import { keys } from '@server/config/keys'

export function formatApolloError(error) {
  if (keys.nodeEnv === 'development') {
    console.error(error)
  }
  return error
}
