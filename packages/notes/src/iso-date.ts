const pad2 = (n: number): string => String(n).padStart(2, "0");

// local time, not toISOString's UTC
export const formatIsoDate = (date: Date): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

export const formatIsoTime = (date: Date): string =>
  `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
