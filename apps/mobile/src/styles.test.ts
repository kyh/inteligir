// the classes read src/styles.css and the props that take a value read src/lib/palette.ts, two
// spellings of one palette that no Metro build compares; this compiles the sheet as the build does,
// Tailwind under PostCSS and then react-native-css, and reads back what each class draws.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import { compile } from "react-native-css/compiler";
import type {
  MediaCondition,
  ReactNativeCssStyleSheet,
  StyleDeclaration,
  StyleDescriptor,
} from "react-native-css/compiler";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { paletteFor } from "@/lib/palette";
import type { Palette } from "@/lib/palette";

const SHEET = path.join(import.meta.dirname, "styles.css");

const isToken = (key: string): key is keyof Palette => Object.hasOwn(paletteFor(false), key);

// every token palette.ts holds, so a color added there alone fails the sheet's check
const TOKENS = Object.keys(paletteFor(false)).filter(isToken);

const SIZES = [12, 13, 14, 15, 16, 30] as const;

const cssName = (token: string): string =>
  token.replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);

// lightningcss writes #ffffff as #fff
const hex = (value: StyleDescriptor): string => {
  const text = z.string().parse(value).toLowerCase();
  const short = /^#(?<r>[0-9a-f])(?<g>[0-9a-f])(?<b>[0-9a-f])$/u.exec(text)?.groups;
  return short === undefined
    ? text
    : `#${short.r}${short.r}${short.g}${short.g}${short.b}${short.b}`;
};

// the classes this suite reads besides the sources' own, spelled for Tailwind to generate
const PROBES = [
  ...TOKENS.map((token) => `bg-${cssName(token)}`),
  "p-4",
  "rounded-lg",
  "leading-[22px]",
  "placeholder:text-muted-foreground",
  ...SIZES.map((size) => `text-${String(size)}`),
];

const compiled = async (): Promise<ReactNativeCssStyleSheet> => {
  const source = `${readFileSync(SHEET, "utf-8")}\n@source inline("${PROBES.join(" ")}");\n`;
  const { css } = await postcss([tailwind()]).process(source, { from: SHEET });
  return compile(css, {
    filename: SHEET,
    projectRoot: path.dirname(import.meta.dirname),
  }).stylesheet();
};

const sheet = await compiled();

const declarationsOf = (className: string): StyleDeclaration[] =>
  (sheet.s ?? [])
    .filter(([name]) => name === className)
    .flatMap(([, rules]) => rules.flatMap((rule) => rule.d ?? []));

const isDark = (conditions: readonly MediaCondition[] | undefined): boolean =>
  JSON.stringify(conditions) === JSON.stringify([["=", "prefers-color-scheme", "dark"]]);

interface Schemes {
  readonly dark: readonly string[];
  readonly light: readonly string[];
}

const schemesOf = (name: string): Schemes => {
  const values = (sheet.vr ?? []).find(([variable]) => variable === name)?.[1] ?? [];
  return {
    dark: values.filter((value) => isDark(value[1])).map((value) => hex(value[0])),
    light: values.filter((value) => value[1] === undefined).map((value) => hex(value[0])),
  };
};

describe("the phone's stylesheet", () => {
  it("declares each palette token at palette.ts's value in light and in dark", () => {
    expect(
      TOKENS.map((token) => ({ token, ...schemesOf(cssName(token)) })),
      "src/styles.css and src/lib/palette.ts spell one palette twice: change a color in both",
    ).toStrictEqual(
      TOKENS.map((token) => ({
        dark: [paletteFor(true)[token]],
        light: [paletteFor(false)[token]],
        token,
      })),
    );
  });

  it("declares no dark variable palette.ts does not hold", () => {
    const darkOnly = (sheet.vr ?? [])
      .filter(([, values]) => values.some((value) => isDark(value[1])))
      .map(([name]) => name);
    expect(darkOnly.toSorted()).toStrictEqual(TOKENS.map(cssName).toSorted());
  });

  it("draws each token's class from the token's own variable", () => {
    expect(
      TOKENS.map((token) => JSON.stringify(declarationsOf(`bg-${cssName(token)}`))),
    ).toStrictEqual(
      TOKENS.map((token) =>
        JSON.stringify([[[{}, "var", cssName(token), 1], "backgroundColor", 1]]),
      ),
    );
  });

  it("reads a rem at the root's 16px, so the spacing step and the radii are the web's", () => {
    expect(
      [declarationsOf("p-4"), declarationsOf("rounded-lg")],
      "react-native-css reads a rem at src/styles.css's `:root` font size, else at 14",
    ).toStrictEqual([[{ padding: 16 }], [{ borderRadius: 8 }]]);
  });

  it("sets a size alone, with no line height beside it", () => {
    expect(
      SIZES.map((size) => declarationsOf(`text-${String(size)}`)),
      "a size class sets the font size alone, as a StyleSheet `fontSize` did",
    ).toStrictEqual(SIZES.map((size) => [{ fontSize: size }]));
  });

  it("draws a line height from its class", () => {
    expect(declarationsOf("leading-[22px]")).toStrictEqual([{ lineHeight: 22 }]);
  });

  it("draws a placeholder's colour from the token's own variable", () => {
    expect(JSON.stringify(declarationsOf("placeholder:text-muted-foreground"))).toBe(
      JSON.stringify([[[{}, "var", "muted-foreground", 1], ["placeholderTextColor"], 1]]),
    );
  });

  it("pads no multi-line field with py-*, which iOS's own top padding then overrides", () => {
    const sources = readdirSync(import.meta.dirname, { recursive: true, encoding: "utf-8" })
      .filter((file) => file.endsWith(".tsx"))
      .map((file) => ({ file, text: readFileSync(path.join(import.meta.dirname, file), "utf-8") }));
    const padded = sources.flatMap(({ file, text }) =>
      text
        .split("<TextInput")
        .slice(1)
        .map((rest) => rest.slice(0, rest.indexOf("/>")))
        .filter((field) => /\bmultiline\b/u.test(field) && /\bpy-/u.test(field))
        .map(() => file),
    );
    expect(
      padded,
      "py-* compiles to paddingBlock, and a multiline TextInput with no paddingTop takes iOS's 5: write pt-* and pb-*",
    ).toStrictEqual([]);
  });
});
