import fontkit from "@pdf-lib/fontkit";
import { StandardFonts } from "pdf-lib";

import { collectionSize, fontInCollection, isCollection } from "./font-collection";
import type { FontFacts } from "./pdf-fonts";
import type { FontChoice } from "./text-edits";

interface LocalFace {
  readonly family: string;
  readonly fullName: string;
  readonly postscriptName: string;
  readonly style: string;
  readonly blob: () => Promise<Blob>;
}

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<LocalFace[]>;
  }
}

const STANDARD = {
  fixed: [
    StandardFonts.Courier,
    StandardFonts.CourierBold,
    StandardFonts.CourierOblique,
    StandardFonts.CourierBoldOblique,
  ],
  sans: [
    StandardFonts.Helvetica,
    StandardFonts.HelveticaBold,
    StandardFonts.HelveticaOblique,
    StandardFonts.HelveticaBoldOblique,
  ],
  serif: [
    StandardFonts.TimesRoman,
    StandardFonts.TimesRomanBold,
    StandardFonts.TimesRomanItalic,
    StandardFonts.TimesRomanBoldItalic,
  ],
} as const;

export const standardFor = (facts: FontFacts | null) => {
  let family: readonly StandardFonts[] = STANDARD.sans;

  if (facts?.fixed === true) {
    family = STANDARD.fixed;
  } else if (facts?.serif === true) {
    family = STANDARD.serif;
  }

  const face = (facts?.bold === true ? 1 : 0) + (facts?.italic === true ? 2 : 0);

  return { kind: "standard", name: family[face] ?? StandardFonts.Helvetica } satisfies FontChoice;
};

const squashed = (name: string) => name.toLowerCase().replaceAll(/[\s_-]/gu, "");

const familyOf = (name: string) =>
  squashed(name.split(/[-,]/u)[0] ?? name).replace(/(?:mt|ps)$/u, "");

const styled = (face: LocalFace, facts: FontFacts) => {
  const style = face.style.toLowerCase();
  const bold = /bold|black|heavy|semibold|demi/u.test(style);
  const italic = /italic|oblique/u.test(style);

  return bold === facts.bold && italic === facts.italic;
};

export const matchFace = (faces: readonly LocalFace[], facts: FontFacts) => {
  const exact = new Set([facts.name, facts.name.replaceAll(",", "-")]);
  const named = faces.find(({ postscriptName }) => exact.has(postscriptName));

  if (named !== undefined) {
    return named;
  }

  const family = familyOf(facts.name);
  const kin = faces.filter((face) => squashed(face.family) === family);

  return kin.find((face) => styled(face, facts)) ?? kin[0] ?? null;
};

const faceBytes = async (face: LocalFace) => {
  const blob = await face.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());

  if (!isCollection(bytes)) {
    return bytes;
  }

  for (let index = 0; index < collectionSize(bytes); index += 1) {
    const single = fontInCollection(bytes, index);

    if (fontkit.create(single).postscriptName === face.postscriptName) {
      return single;
    }
  }

  return null;
};

const browserFaces = async () => await (window.queryLocalFonts?.() ?? Promise.resolve([]));

export const systemFontChooser = (query: () => Promise<readonly LocalFace[]> = browserFaces) => {
  let faces: Promise<readonly LocalFace[]> | null = null;

  const listed = async () => {
    faces ??= query().catch(() => []);

    return await faces;
  };

  return {
    choose: async (facts: FontFacts | null) => {
      const face = facts === null ? null : matchFace(await listed(), facts);
      const bytes = face === null ? null : await faceBytes(face).catch(() => null);

      return face === null || bytes === null
        ? standardFor(facts)
        : ({ bytes, key: face.postscriptName, kind: "system" } satisfies FontChoice);
    },
    warm: listed,
  };
};

export const tabFonts = systemFontChooser();
