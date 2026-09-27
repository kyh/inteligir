// A selection the agent is asked about, quoted as the start of the message, so the Mac's composer
// and the phone's start a question the same way.
export const quoteSelection = (text: string): string =>
  `${text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}\n\n`;
