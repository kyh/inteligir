// what the field holds with a passage the person asked about quoted under it, ready for their
// question; asked about twice, it is quoted once
export const quotePassage = (message: string, passage: string): string => {
  const quote = `${passage
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}\n\n`;
  if (message.includes(quote)) {
    return message;
  }
  return message.trim() === "" ? quote : `${message.trimEnd()}\n\n${quote}`;
};
