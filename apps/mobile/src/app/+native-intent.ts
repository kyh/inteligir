// the share extension opens the app at its handoff address, which the share inbox reads from the
// App Group; the router lands on the Library instead of an unmatched route
import { isShareHandoff } from "@/items/share-payload";

export const redirectSystemPath = ({ path }: { path: string; initial: boolean }): string =>
  isShareHandoff(path) ? "/" : path;
