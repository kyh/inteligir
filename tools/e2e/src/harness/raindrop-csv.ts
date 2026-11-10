// A Raindrop backup as its CSV export writes one, the file an import scenario hands the cloud.

const HEADER = "id,title,note,excerpt,url,folder,tags,created,cover,highlights,favorite";

// a CSV cell: quoted when it holds a comma, a quote or a line break, its quotes doubled
const cell = (value: string): string =>
  /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

// each row's cells in HEADER's order
export const raindropCsv = (rows: readonly (readonly string[])[]): string =>
  `${[HEADER, ...rows.map((row) => row.map(cell).join(","))].join("\n")}\n`;
