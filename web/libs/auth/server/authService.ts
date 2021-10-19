import Iron from "@hapi/iron";
import { hash, compare } from "bcrypt";

const SALT_ROUNDS = 10;

export const createLoginSession = async (
  session: any,
  secret: Iron.Password
) => {
  const createdAt = Date.now();
  const obj = { ...session, createdAt };
  const token = await Iron.seal(obj, secret, Iron.defaults);

  return token;
};

export const getLoginSession = async (token: string, secret: Iron.Password) => {
  const session = await Iron.unseal(token, secret, Iron.defaults);
  const expiresAt = session.createdAt + session.maxAge * 1000;

  // Validate the expiration date of the session
  if (session.maxAge && Date.now() > expiresAt) {
    throw new Error("Session expired");
  }

  return session;
};

export const createPasswordHash = async (password: string) => {
  const passwordHash = await hash(password, SALT_ROUNDS);
  return passwordHash;
};

export const validatePassword = async (
  passwordHash: string,
  password: string
) => {
  const isMatchingPassword = await compare(password, passwordHash);
  return isMatchingPassword;
};
