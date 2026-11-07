// A photo from the camera or the library, scaled down and re-encoded, then saved as an image item
// of its own through the replica's outbox, so one taken offline lands once the phone is back. The
// re-encode writes no EXIF, so where the photo was taken never reaches the library or its history.
// A HEIC becomes a JPEG here, since the Mac's editor and every browser take one, and a PNG stays
// a PNG. Only a screen imports this; it loads native modules.

import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import {
  launchCameraAsync,
  launchImageLibraryAsync,
  requestCameraPermissionsAsync,
} from "expo-image-picker";
import type { ImagePickerOptions } from "expo-image-picker";
import { ActionSheetIOS } from "react-native";
import { messageOf } from "../lib/error-message";
import type { LibraryReplica } from "@repo/library-replica/library-replica";
import { photoName, photoResize, photoType } from "./photo-plan";
import type { PhotoType } from "./photo-plan";

export type PhotoIngest =
  | { kind: "picked"; itemId: string }
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

interface PickedPhoto {
  kind: "photo";
  type: PhotoType;
  uri: string;
}

const pick = async (source: PhotoSource): Promise<PhotoIngest | PickedPhoto> => {
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
  return asset === undefined
    ? { kind: "cancelled" }
    : { kind: "photo", type: photoType(asset.mimeType), uri: asset.uri };
};

// the size is read off the decoded image: the picker may answer 0 for one it was not told
const reencoded = async ({ type, uri }: PickedPhoto): Promise<Uint8Array<ArrayBuffer>> => {
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const size = photoResize(original.width, original.height);
  const image =
    size === null
      ? original
      : await ImageManipulator.manipulate(original).resize(size).renderAsync();
  const saved = await image.saveAsync(
    type === "image/png"
      ? { format: SaveFormat.PNG }
      : { compress: JPEG_QUALITY, format: SaveFormat.JPEG },
  );
  const file = new File(saved.uri);
  const bytes = await file.bytes();
  try {
    file.delete();
  } catch {
    // a copy left in the cache is the OS's to purge
  }
  return new Uint8Array(bytes);
};

export const ingestPhoto = async (
  replica: LibraryReplica,
  folderId: string | null,
): Promise<PhotoIngest> => {
  const source = await chooseSource();
  if (source === null) {
    return { kind: "cancelled" };
  }
  try {
    const picked = await pick(source);
    if (picked.kind !== "photo") {
      return picked;
    }
    const made = await replica.createFile({
      file: { bytes: await reencoded(picked), mime: picked.type },
      folderId,
      name: photoName(new Date(), picked.type),
      tags: [],
    });
    return { itemId: made.id, kind: "picked" };
  } catch (error) {
    return {
      kind: "refused",
      message: `The photo could not be added: ${messageOf(error)}`,
    };
  }
};
