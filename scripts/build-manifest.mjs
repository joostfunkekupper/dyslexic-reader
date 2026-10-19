// Scans books/*.md and writes books/index.json: [{ slug, file, title, words, level }].
// The title is the first non-empty line of each file, with any leading "#" removed.
// The reading level (1-3) is estimated from the text; see readingLevel() below.
// Run locally with: node scripts/build-manifest.mjs

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const booksDir = join(root, "books");

const files = (await readdir(booksDir))
  .filter((f) => f.toLowerCase().endsWith(".md"))
  .sort((a, b) => a.localeCompare(b));

const sentenceSegmenter = new Intl.Segmenter("en", { granularity: "sentence" });

/**
 * Estimates difficulty from the body text (everything after the title):
 *   score = 10 x average word length + words per sentence + % of words with 7+ letters
 * Level 1 "First words" (score < 40) is short decodable text like CVC books;
 * level 2 "Early reader" (< 52) and level 3 "Growing reader" (52+) split the longer stories.
 */
function readingLevel(body) {
  const text = body
    .split("\n")
    .filter((line) => !/^\s*(#|([-*_])(\s*\2){2,}\s*$)/.test(line))
    .join(" ")
    .replace(/[*_`>]/g, "");
  const words = text.match(/[A-Za-z']+/g) ?? [];
  if (!words.length) return { words: 0, level: 1 };
  const sentences = [...sentenceSegmenter.segment(text)].filter((s) => /[A-Za-z]/.test(s.segment)).length || 1;
  const avgLength = words.reduce((n, w) => n + w.replace(/'/g, "").length, 0) / words.length;
  const longPct = (100 * words.filter((w) => w.replace(/'/g, "").length >= 7).length) / words.length;
  const score = 10 * avgLength + words.length / sentences + longPct;
  return { words: words.length, level: score < 40 ? 1 : score < 52 ? 2 : 3 };
}

const books = [];
for (const file of files) {
  const text = (await readFile(join(booksDir, file), "utf8")).replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const titleIdx = lines.findIndex((line) => line.trim() !== "");
  const slug = file.replace(/\.md$/i, "");
  const title = (lines[titleIdx] ?? "").replace(/^#+\s*/, "").trim() || slug;
  books.push({ slug, file, title, ...readingLevel(lines.slice(titleIdx + 1).join("\n")) });
}

books.sort((a, b) => a.level - b.level || a.title.localeCompare(b.title));
await writeFile(join(booksDir, "index.json"), JSON.stringify(books, null, 2) + "\n");
console.log(`Wrote ${books.length} book(s) to books/index.json`);
