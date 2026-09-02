function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// local time, not toISOString's UTC
export function formatIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
