import { isShareHandoff } from "@/items/share-payload";

export const redirectSystemPath = ({ path }: { path: string; initial: boolean }) =>
  isShareHandoff(path) ? "/" : path;
