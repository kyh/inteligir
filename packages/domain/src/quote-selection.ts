// A selection the agent is asked about, quoted as the start of the message.
export const quoteSelection = (text: string): string =>
  `${text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}\n\n`;
