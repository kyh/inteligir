import { User } from "@prisma/client";
import { sign } from "jsonwebtoken";
import { hash, compare } from "bcrypt";

const SALT_ROUNDS = 10;

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

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || "a-secret";
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || "r-secret";

export const createAccessToken = (user: Partial<User>) => {
  return sign({ ...user }, ACCESS_TOKEN_SECRET, {
    expiresIn: "15m",
  });
};

export const createRefreshToken = (user: Partial<User>) => {
  return sign({ ...user }, REFRESH_TOKEN_SECRET, {
    expiresIn: "7d",
  });
};
