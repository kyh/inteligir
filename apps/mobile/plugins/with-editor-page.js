// oxlint-disable unicorn/prefer-module -- expo requires this file; the package is not type: module
// Ships the editor page inside the binary: the built page (`pnpm --filter @repo/mobile-editor
// build`, which the ios, testflight and hotfix scripts and EAS's post-install hook run first) joins
// the app target's Copy Bundle Resources as a folder reference, so a note opens from file://
// offline. Xcode copies a folder under the name it has on disk, whatever the reference is called,
// so ios/ holds a link of the bundle's name to the build.
const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod, withXcodeProject } = require("expo/config-plugins");

// src/editor/page-folder.ts spells the name the phone loads; a test holds the two together
const EDITOR_PAGE_FOLDER = "editor-page";

// from the app's root
const PAGE_BUILD = path.join("..", "mobile-editor", "dist");

/** @param {import("expo/config").ExpoConfig} config the config expo builds the app from
 *  @returns {import("expo/config").ExpoConfig} the config, with ios/ linking the page's build */
const withPageLink = (config) =>
  withDangerousMod(config, [
    "ios",
    (modConfig) => {
      const { platformProjectRoot, projectRoot } = modConfig.modRequest;
      const link = path.join(platformProjectRoot, EDITOR_PAGE_FOLDER);
      // a stale link goes; a real folder under the name refuses the prebuild rather than going
      fs.rmSync(link, { force: true });
      fs.symlinkSync(
        path.relative(platformProjectRoot, path.join(projectRoot, PAGE_BUILD)),
        link,
        "dir",
      );
      return modConfig;
    },
  ]);

/** @param {import("expo/config").ExpoConfig} config the config expo builds the app from
 *  @returns {import("expo/config").ExpoConfig} the config, with the page a bundle resource */
const withPageReference = (config) =>
  withXcodeProject(config, (modConfig) => {
    const project = modConfig.modResults;
    if (project.hasFile(EDITOR_PAGE_FOLDER)) {
      return modConfig;
    }
    // a folder reference, which expo's resource helper cannot write: it types a file by its extension
    const file = {
      basename: EDITOR_PAGE_FOLDER,
      fileRef: project.generateUuid(),
      group: "Resources",
      includeInIndex: 0,
      lastKnownFileType: "folder",
      path: EDITOR_PAGE_FOLDER,
      sourceTree: '"<group>"',
      target: project.getTarget("com.apple.product-type.application")?.uuid,
      uuid: project.generateUuid(),
    };
    project.addToPbxFileReferenceSection(file);
    project.addToPbxBuildFileSection(file);
    project.addToPbxResourcesBuildPhase(file);
    const { mainGroup } = project.getFirstProject().firstProject;
    project.getPBXGroupByKey(mainGroup).children.push({
      comment: EDITOR_PAGE_FOLDER,
      value: file.fileRef,
    });
    return modConfig;
  });

/** @param {import("expo/config").ExpoConfig} config the config expo builds the app from
 *  @returns {import("expo/config").ExpoConfig} the config, carrying the editor page */
const withEditorPage = (config) => withPageReference(withPageLink(config));

// expo takes `default` as the plugin; the name rides beside it for the phone's own test
module.exports = { EDITOR_PAGE_FOLDER, default: withEditorPage };
