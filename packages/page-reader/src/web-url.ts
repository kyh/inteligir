export const resolveWebUrl = (raw: string, base?: string) => {
  const trimmed = raw.trim();

  if (trimmed === "" || trimmed.startsWith("#") || /^data:/iu.test(trimmed)) {
    return null;
  }

  try {
    const url = new URL(trimmed, base);

    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};
