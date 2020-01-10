import { Photon } from '@prisma/photon'
import { parseRequest, getUser } from '@server/services/authentication'

export const photon = new Photon()

export interface Context {
  photon: Photon
  request: any
  response: any
  user: any
}

export function createContext({ req, res }: any) {
  const token = parseRequest(req)
  return {
    photon,
    request: req,
    response: res,
    user: getUser(token),
  }
}
