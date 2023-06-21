import Csrf from "csrf";

export async function createCsrfSecret(existingSecret?: Maybe<unknown>) {
  const csrf = new Csrf();

  const useExistingSecret =
    existingSecret && typeof existingSecret === "string";

  return useExistingSecret ? existingSecret : await csrf.secret();
}

export async function createCsrfToken(secret: string) {
  return new Csrf().create(secret);
}

export default createCsrfToken;
