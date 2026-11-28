import type { StandardFonts } from "pdf-lib";

import type { Box } from "./pdf-strip";

export interface Color {
  readonly blue: number;
  readonly green: number;
  readonly red: number;
}

export type FontChoice =
  | { readonly kind: "standard"; readonly name: StandardFonts }
  | { readonly bytes: Uint8Array; readonly key: string; readonly kind: "system" };

export interface TextEdit {
  readonly background: Color;
  readonly box: Box;
  readonly color: Color;
  readonly page: number;
  readonly size: number;
  readonly text: string;
  readonly x: number;
  readonly y: number;
}

export class UnwritableTextError extends Error {
  readonly text: string;

  constructor(text: string) {
    super(`"${text}" has a letter this font can't write.`);
    this.name = "UnwritableTextError";
    this.text = text;
  }
}
