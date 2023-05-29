/** @type {import('prettier').Config} */
module.exports = {
  importOrder: [
    "^(react/(.*)$)|^(react$)",
    "^(next/(.*)$)|^(next$)",
    "<THIRD_PARTY_MODULES>",
    "^~/core/(.*)$",
    "^~/lib/(.*)$",
    "^~/components/(.*)$",
    "^~/styles/(.*)$",
    "^~/app/(.*)$",
    "^types$",
    "^[./]",
  ],
  plugins: ["@ianvs/prettier-plugin-sort-imports"],
};
