import { NextApiRequest } from "next";
import { throwMethodNotAllowedException } from "~/core/http-exceptions";

const withMethodsGuard = (request: NextApiRequest, methods: HttpMethod[]) => {
  const method = request.method as HttpMethod;

  if (
    !methods
      .map((method) => method.toLowerCase())
      .includes(method.toLowerCase())
  ) {
    throwMethodNotAllowedException(methods, method);
  }
};

export default withMethodsGuard;
