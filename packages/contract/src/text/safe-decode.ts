// a percent-decoded url part; a bad escape leaves the text as it was written
export const safeDecode = (text: string): string => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};
