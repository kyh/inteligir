const notFound = () =>
  Response.json({ code: "NOT_FOUND", message: "No route answers at this path." }, { status: 404 });

export {
  notFound as DELETE,
  notFound as GET,
  notFound as PATCH,
  notFound as POST,
  notFound as PUT,
};
