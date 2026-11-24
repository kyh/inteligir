export const quotePassage = (message: string, passage: string) => {
  const quote = `${passage
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}\n\n`;

  if (message.includes(quote)) {
    return message;
  }

  return message.trim() === "" ? quote : `${message.trimEnd()}\n\n${quote}`;
};
