// what a delete asks, by how many files only the item shows and so go with it
export const deleteQuestion = (name: string, freed: number): string => {
  if (freed === 0) {
    return `Delete “${name}”?`;
  }
  return freed === 1
    ? `Delete “${name}” and the file only it shows?`
    : `Delete “${name}” and the ${String(freed)} files only it shows?`;
};
