// A photo from the camera or the library, scaled down and re-encoded as a JPEG, then kept in the
// vault through file-ops. The re-encode writes no EXIF, so where the photo was taken never reaches
// the vault or its history. A HEIC is decoded here too, since the vault and the Mac's editor take
// JPEG. Only a screen imports this; it loads native modules.

import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import {
  launchCameraAsync,
  launchImageLibraryAsync,
  requestCameraPermissionsAsync,
} from "expo-image-picker";
import type { ImagePickerOptions } from "expo-image-picker";
import { ActionSheetIOS } from "react-native";
import type { FileOps } from "./file-ops";
import { photoBaseName, photoResize } from "./photo-plan";

export type PhotoIngest =
  | { kind: "picked"; path: string }
  | { kind: "cancelled" }
  | { kind: "refused"; message: string };

type PhotoSource = "camera" | "library";

// the first row is the sheet's cancel
const CHOICES: readonly { label: string; source: PhotoSource | null }[] = [
  { label: "Cancel", source: null },
  { label: "Take Photo", source: "camera" },
  { label: "Choose from Library", source: "library" },
];

const PICKER_OPTIONS: ImagePickerOptions = {
  allowsMultipleSelection: false,
  exif: false,
  mediaTypes: ["images"],
};

const JPEG_QUALITY = 0.8;

const chooseSource = async (): Promise<PhotoSource | null> =>
  // oxlint-disable-next-line promise/avoid-new -- the sheet answers through a callback, which only a promise can hand to an await
  await new Promise((resolve) => {
    ActionSheetIOS.showActionSheetWithOptions(
      { cancelButtonIndex: 0, options: CHOICES.map((choice) => choice.label) },
      (index) => {
        resolve(CHOICES[index]?.source ?? null);
      },
    );
  });

const pick = async (source: PhotoSource): Promise<PhotoIngest | { kind: "uri"; uri: string }> => {
  if (source === "camera") {
    const permission = await requestCameraPermissionsAsync();
    if (!permission.granted) {
      return {
        kind: "refused",
        message: "To take a photo, allow camera access for Inteligir in Settings.",
      };
    }
  }
  const result =
    source === "camera"
      ? await launchCameraAsync(PICKER_OPTIONS)
      : await launchImageLibraryAsync(PICKER_OPTIONS);
  const asset = result.canceled ? undefined : result.assets[0];
  return asset === undefined ? { kind: "cancelled" } : { kind: "uri", uri: asset.uri };
};

// the size is read off the decoded image: the picker may answer 0 for one it was not told
const reencoded = async (uri: string): Promise<Uint8Array> => {
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const size = photoResize(original.width, original.height);
  const image =
    size === null
      ? original
      : await ImageManipulator.manipulate(original).resize(size).renderAsync();
  const saved = await image.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
  const file = new File(saved.uri);
  const bytes = await file.bytes();
  try {
    file.delete();
  } catch {
    // a copy left in the cache is the OS's to purge
  }
  return bytes;
};

export const ingestPhoto = async (fileOps: FileOps): Promise<PhotoIngest> => {
  const source = await chooseSource();
  if (source === null) {
    return { kind: "cancelled" };
  }
  try {
    const picked = await pick(source);
    if (picked.kind !== "uri") {
      return picked;
    }
    const written = await fileOps.writeAsset(
      photoBaseName(new Date()),
      await reencoded(picked.uri),
    );
    return written.kind === "written"
      ? { kind: "picked", path: written.path }
      : { kind: "refused", message: written.message };
  } catch (error) {
    return {
      kind: "refused",
      message: `The photo could not be added: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};
