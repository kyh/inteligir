const SAVED_ADDRESS_MS = 60_000;

export const saveBlob = (blob: Blob, name: string) => {
  const address = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = address;
  link.download = name;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(address);
  }, SAVED_ADDRESS_MS);
};
