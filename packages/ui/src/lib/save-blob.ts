// A file handed to the browser's own download from bytes the page already holds, one not sent up
// yet among them. The address the link names is a blob of the page's own origin, the one a
// `download` link keeps its name on
// (https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a#download), so the file
// lands in Downloads under its own name, and the page stays where it is.

// how long a saved file's address outlives the click that saved it, so the save has begun
const SAVED_ADDRESS_MS = 60_000;

export const saveBlob = (blob: Blob, name: string): void => {
  const address = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = address;
  link.download = name;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(address);
  }, SAVED_ADDRESS_MS);
};
