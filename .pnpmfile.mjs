// drizzle-orm peers expo-sqlite optionally, and pnpm binds an optional peer any workspace installs,
// so the phone's expo-sqlite pulls expo and react-native into the server's drizzle-orm, and a fresh
// resolution splits it into one copy per react-native peer chain, where a second copy fails every
// instanceof across the two. Nothing runs drizzle on the phone. An `overrides` removal drops
// dependencies, never a peer.
export const hooks = {
  readPackage(manifest) {
    if (manifest.name === "drizzle-orm") {
      delete manifest.peerDependencies?.["expo-sqlite"];
      delete manifest.peerDependenciesMeta?.["expo-sqlite"];
    }
    return manifest;
  },
};
