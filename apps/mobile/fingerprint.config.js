// oxlint-disable unicorn/prefer-module -- expo requires this file; the package is not type: module
// The editor page ships inside the binary, so a change to it is a native change: its build joins the
// fingerprint an EAS Update is matched on, and an update bundled beside another page reaches no
// install. The testflight and hotfix scripts build the page before the fingerprint is taken.

/** @type {import("expo/fingerprint").Config} */
const fingerprintConfig = {
  extraSources: [
    {
      filePath: "../mobile-editor/dist",
      reasons: ["the editor page the app bundle carries"],
      type: "dir",
    },
  ],
};

module.exports = fingerprintConfig;
