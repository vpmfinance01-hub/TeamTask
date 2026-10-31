// Извлича всички текстове, обвити в t("…") / tr("…"), и показва кои нямат превод: node scripts/i18n-keys.mjs [--list]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../src", import.meta.url));
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?)$/.test(f) && !/dict\.ts$/.test(f)) files.push(p);
  }
})(root);

const keys = new Set();
const re = /\b(?:t|tr)\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(re)) {
    const k = m[2].replace(/\\"/g, '"').replace(/\\'/g, "'");
    if (/[А-Яа-я]/.test(k)) keys.add(k);
  }
}
// KIND_LABEL и етикети, превеждани косвено
for (const k of ["Смяна", "Почивен ден", "Отпуск", "Болничен", "За изпълнение", "Чака одобрение", "Одобрено", "Върнато", "Собственик", "Ръководител", "Служител",
  "Всички", "Просрочени", "Чакат одобрение", "Одобрени", "Върнати"]) keys.add(k);

const { DICT } = await import("../src/lib/dict.ts").catch(() => ({ DICT: null }));
const langs = ["en", "ru", "uk"];
if (process.argv.includes("--list") || !DICT) {
  console.log([...keys].sort().join("\n"));
  console.log(`\n${keys.size} текста`);
} else {
  for (const l of langs) {
    const missing = [...keys].filter((k) => !DICT[l]?.[k]);
    const extra = Object.keys(DICT[l] ?? {}).filter((k) => !keys.has(k));
    console.log(`${l}: ${keys.size - missing.length}/${keys.size} преведени, липсват ${missing.length}, излишни ${extra.length}`);
    if (missing.length) console.log("  липсват:\n   " + missing.join("\n   "));
  }
}
