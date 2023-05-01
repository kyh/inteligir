import fs from "fs";
import path from "path";

const fsp = fs.promises;
const localeDir = path.resolve(__dirname, "public/locales/en");

async function readTranslationFiles(dir) {
  const translations = {};
  const files = await fsp.readdir(dir);

  await Promise.all(
    files.map(async (filename) => {
      const full = path.join(dir, filename);
      const content = await fsp.readFile(full, { encoding: "utf8" });
      translations[filename.replace(".json", "")] = JSON.parse(content);
    })
  );

  return translations;
}

function index(obj, is, value) {
  if (typeof is == "string") return index(obj, is.split("."), value);
  else if (is.length == 1 && value !== undefined) return (obj[is[0]] = value);
  else if (is.length == 0) return obj;
  else return index(obj[is[0]], is.slice(1), value);
}

export default async function transformer(file, { jscodeshift: j }) {
  const translations = await readTranslationFiles(localeDir);

  const source = j(file.source);

  source.findJSXElements("Trans").forEach((element) => {
    let replaceString = "";

    j(element)
      .find(j.JSXAttribute)
      .filter((attribute) => attribute.node.name.name === "i18nKey")
      .forEach((attribute) => {
        if (attribute.node.value.type === "StringLiteral") {
          replaceString = attribute.node.value.value;
        } else {
          replaceString = attribute.node.value.expression.value;
        }
      });

    const [key, value] = replaceString.split(":");
    const translationObj = translations[key];
    const translationValue = index(translationObj, value);

    j(element).replaceWith(translationValue);
  });

  return source.toSource();
}
