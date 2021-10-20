export const requireLoginMiddleware = function (req: any, res: any, next: any) {
  if (!req.user) {
    return res.status(401).send({ error: "Login Required" });
  }

  next();
};
