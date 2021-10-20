import cookieSession from "cookie-session";

const COOKIE_NAME = "session";
const COOKIE_SECRET = process.env.COOKIE_SECRET || "secret";

export const sessionMiddleware = cookieSession({
  name: COOKIE_NAME,
  keys: [COOKIE_SECRET],
  httpOnly: true,
  maxAge: 24 * 60 * 60 * 1000 * 30,
  // Do not change the lines below, they make cy.auth() work in e2e tests
  secure: process.env.NODE_ENV !== "development" && !process.env.INSECURE_AUTH,
  signed: process.env.NODE_ENV !== "development" && !process.env.INSECURE_AUTH,
});
