import { verify } from 'jsonwebtoken'
import { keys } from '@server/config/keys'

/**
 * Given a request instance, return back the token from either `Authorization`
 * header or `token` Cookie.
 * @param {Request} request
 */
export function parseRequest(req: any) {
  const { authorization } = req.headers
  if (authorization) {
    return authorization && authorization.split(' ')[1]
  }
  return req.cookies.token
}

export function getUser(token: string) {
  if (token) {
    const user = verify(token, keys.auth.jwtSecret)
    return user
  }
  return null
}
