import Csrf from "csrf";

/**
 * @name createCsrfSecret
 * @param existingSecret
 */
export async function createCsrfSecret(existingSecret?: Maybe<unknown>) {
  const csrf = new Csrf();

  const useExistingSecret =
    existingSecret && typeof existingSecret === "string";

  return useExistingSecret ? existingSecret : await csrf.secret();
}

/**
 * @name createCsrfToken
 * @param secret
 */
export async function createCsrfToken(secret: string) {
  return new Csrf().create(secret);
}

export default createCsrfToken;
