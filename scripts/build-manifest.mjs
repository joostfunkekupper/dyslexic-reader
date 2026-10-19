// Scans books/*.md and writes books/index.json: [{ slug, file, title }].
// The title is the first non-empty line of each file, with any leading "#" removed.
// Run locally with: node scripts/build-manifest.mjs

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const booksDir = join(root, "books");

const files = (await readdir(booksDir))
  .filter((f) => f.toLowerCase().endsWith(".md"))
  .sort((a, b) => a.localeCompare(b));

const books = [];
for (const file of files) {
  const text = await readFile(join(booksDir, file), "utf8");
  const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== "") ?? "";
  const slug = file.replace(/\.md$/i, "");
  const title = firstLine.replace(/^#+\s*/, "").trim() || slug;
  books.push({ slug, file, title });
}

books.sort((a, b) => a.title.localeCompare(b.title));
await writeFile(join(booksDir, "index.json"), JSON.stringify(books, null, 2) + "\n");
console.log(`Wrote ${books.length} book(s) to books/index.json`);
