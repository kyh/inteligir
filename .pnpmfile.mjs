export const hooks = {
  readPackage(manifest) {
    if (manifest.name === "drizzle-orm") {
      delete manifest.peerDependencies?.["expo-sqlite"];
      delete manifest.peerDependenciesMeta?.["expo-sqlite"];
    }

    return manifest;
  },
};
