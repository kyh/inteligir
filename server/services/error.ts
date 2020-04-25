import { keys } from "config/keys";
import { GraphQLError } from "graphql";

export function formatApolloError(error: GraphQLError) {
  if (keys.nodeEnv === "development") {
    console.error(error);
  }
  return error;
}
