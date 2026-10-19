"use strict";

const app = document.getElementById("app");

// ---------- Settings (persisted per browser) ----------

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

const settings = {
  size: store.get("size", 24),
  spp: store.get("spp", 3),
  lh: store.get("lh", 1.8),
  width: store.get("width", "medium"),
};

// Column widths in multiples of the text size (roughly characters per line); null = whole window.
const WIDTHS = { narrow: 28, medium: 38, wide: 55, full: null };
if (!(settings.width in WIDTHS)) settings.width = "medium";

function applyReadingVars() {
  const root = document.documentElement.style;
  root.setProperty("--reading-size", settings.size + "px");
  root.setProperty("--reading-lh", String(settings.lh));
  const n = WIDTHS[settings.width];
  root.setProperty("--column-width", n ? `calc(var(--reading-size) * ${n})` : "none");
}
applyReadingVars();

// ---------- Reading settings panel (in the toolbar, shown while reading) ----------

const settingsBtn = document.getElementById("settings-toggle");
const settingsPanel = document.getElementById("settings-panel");
let onSppChange = () => {};

settingsPanel.addEventListener("toggle", (e) => {
  settingsBtn.setAttribute("aria-expanded", String(e.newState === "open"));
});

bindSlider("size", (v) => `${v}px`, applyReadingVars);
bindSlider("lh", (v) => v.toFixed(1), applyReadingVars);
bindSlider("spp", (v) => String(v), () => onSppChange());

for (const radio of document.querySelectorAll('#width input[name="width"]')) {
  radio.checked = radio.value === settings.width;
  radio.addEventListener("change", () => {
    settings.width = radio.value;
    store.set("width", settings.width);
    applyReadingVars();
  });
}

function bindSlider(key, format, onChange) {
  const input = document.getElementById(key);
  const output = document.getElementById(key + "-out");
  input.value = settings[key];
  output.textContent = format(settings[key]);
  input.addEventListener("input", () => {
    settings[key] = Number(input.value);
    output.textContent = format(settings[key]);
    store.set(key, settings[key]);
    onChange();
  });
}

// ---------- Theme: auto -> light -> dark ----------

const themeBtn = document.getElementById("theme-toggle");
const themeIcon = document.getElementById("theme-icon");
const THEMES = ["auto", "light", "dark"];
const THEME_ICONS = { auto: "◐", light: "☀", dark: "☾" };

function applyTheme(theme) {
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  themeIcon.textContent = THEME_ICONS[theme];
  const label = `Theme: ${theme === "auto" ? "automatic" : theme}`;
  themeBtn.setAttribute("aria-label", label);
  themeBtn.title = label;
}

let theme = (() => {
  try { return localStorage.getItem("theme") || "auto"; } catch { return "auto"; }
})();
if (!THEMES.includes(theme)) theme = "auto";
applyTheme(theme);

themeBtn.addEventListener("click", () => {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  try { localStorage.setItem("theme", theme); } catch {}
  applyTheme(theme);
});

// ---------- Data ----------

let booksCache = null;
async function loadBooks() {
  if (!booksCache) {
    const res = await fetch("books/index.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`Could not load book list (${res.status})`);
    booksCache = await res.json();
  }
  return booksCache;
}

async function loadBook(slug) {
  const books = await loadBooks();
  const meta = books.find((b) => b.slug === slug);
  if (!meta) throw new Error("Book not found");
  const res = await fetch("books/" + encodeURIComponent(meta.file), { cache: "no-cache" });
  if (!res.ok) throw new Error(`Could not load book (${res.status})`);
  return { meta, ...parseBook(await res.text()) };
}

// ---------- Markdown -> sentences ----------

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function inline(s) {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`)
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_(?!\s)(.+?)_(?!\w)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1");
}

const segmenter = typeof Intl !== "undefined" && Intl.Segmenter
  ? new Intl.Segmenter("en", { granularity: "sentence" })
  : null;

function splitSentences(text) {
  if (segmenter) {
    return Array.from(segmenter.segment(text), (s) => s.segment.trim()).filter(Boolean);
  }
  return (text.match(/[^.!?]+(?:[.!?]+["'”’)\]]*|$)/g) || []).map((s) => s.trim()).filter(Boolean);
}

/**
 * Turns a Markdown book into a flat list of sentences. Each sentence knows which
 * paragraph it belongs to, plus any headings / scene breaks that come before it,
 * so a page can show any N consecutive sentences with paragraphs kept intact.
 */
function parseBook(md) {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const firstIdx = lines.findIndex((l) => l.trim() !== "");
  const title = firstIdx >= 0 ? lines[firstIdx].replace(/^#+\s*/, "").trim() : "";
  const body = lines.slice(firstIdx + 1);

  const blocks = [];
  let para = [];
  const flush = () => {
    if (para.length) blocks.push({ type: "p", text: para.join(" ") });
    para = [];
  };

  for (const raw of body) {
    const line = raw.trim();
    if (line === "") { flush(); continue; }
    if (/^#{1,6}\s+/.test(line)) { flush(); blocks.push({ type: "h", text: line.replace(/^#+\s*/, "") }); continue; }
    if (/^([-*_])(\s*\1){2,}$/.test(line)) { flush(); blocks.push({ type: "hr" }); continue; }
    if (/^([-*+]|\d+[.)])\s+/.test(line)) { flush(); para.push(line.replace(/^([-*+]|\d+[.)])\s+/, "")); flush(); continue; }
    para.push(line.replace(/^>\s?/, ""));
  }
  flush();

  const sentences = [];
  let pending = [];
  blocks.forEach((block, i) => {
    if (block.type !== "p") { pending.push(block); return; }
    for (const s of splitSentences(block.text)) {
      sentences.push({ html: inline(s), para: i, before: pending });
      pending = [];
    }
  });

  return { title, sentences };
}

// ---------- Routing ----------

function route() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [view, ...rest] = hash.split("/");
  if (view === "read" && rest.length) renderReader(decodeURIComponent(rest.join("/")));
  else renderLibrary();
}
window.addEventListener("hashchange", route);

// ---------- Library ----------

async function renderLibrary() {
  cleanupReader();
  document.title = "Dyslexic Reader";
  app.replaceChildren(document.getElementById("library-tpl").content.cloneNode(true));
  const list = app.querySelector(".book-list");

  let books;
  try {
    books = await loadBooks();
  } catch (err) {
    list.outerHTML = `<p class="message">${escapeHtml(err.message)}. If you're running locally, run <code>node scripts/build-manifest.mjs</code> first.</p>`;
    return;
  }
  if (!books.length) {
    list.outerHTML = `<p class="message">No books yet. Add a Markdown file to the <code>books</code> folder.</p>`;
    return;
  }

  for (const book of books) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = "#/read/" + encodeURIComponent(book.slug);
    const name = document.createElement("span");
    name.textContent = book.title;
    a.append(name);
    const pos = store.get("progress:" + book.slug, null);
    if (pos && pos.total) {
      const pct = Math.min(100, Math.round(((pos.index + 1) / pos.total) * 100));
      const prog = document.createElement("span");
      prog.className = "progress";
      prog.textContent = pct >= 100 ? "Finished" : `${pct}% read`;
      a.append(prog);
    }
    li.append(a);
    list.append(li);
  }
}

// ---------- Reader ----------

let readerKeyHandler = null;

function cleanupReader() {
  if (readerKeyHandler) document.removeEventListener("keydown", readerKeyHandler);
  readerKeyHandler = null;
  onSppChange = () => {};
  settingsBtn.hidden = true;
  if (settingsPanel.matches(":popover-open")) settingsPanel.hidePopover();
}

async function renderReader(slug) {
  cleanupReader();
  app.replaceChildren(document.getElementById("reader-tpl").content.cloneNode(true));
  const $ = (sel) => app.querySelector(sel);
  const pageEl = $(".page");
  const prevBtn = $(".prev");
  const nextBtn = $(".next");
  const pageNum = $(".page-num");

  let book;
  try {
    book = await loadBook(slug);
  } catch (err) {
    pageEl.innerHTML = `<p class="message">${escapeHtml(err.message)}.</p>`;
    $(".pager").hidden = true;
    return;
  }

  const title = book.title || book.meta.title;
  $(".book-title").textContent = title;
  document.title = `${title} · Dyslexic Reader`;

  const total = book.sentences.length;
  const progressKey = "progress:" + slug;
  // Position is tracked by sentence, so changing sentences-per-page keeps your place.
  let index = Math.min(store.get(progressKey, { index: 0 }).index || 0, Math.max(0, total - 1));

  const pageCount = () => Math.max(1, Math.ceil(total / settings.spp));
  const currentPage = () => Math.floor(index / settings.spp);

  function draw({ focus = false } = {}) {
    const page = currentPage();
    const start = page * settings.spp;
    const slice = book.sentences.slice(start, start + settings.spp);

    let html = "";
    let openPara = null;
    for (const s of slice) {
      if (s.para !== openPara) {
        if (openPara !== null) html += "</p>";
        for (const b of s.before) html += b.type === "h" ? `<h2>${inline(b.text)}</h2>` : "<hr>";
        html += "<p>";
        openPara = s.para;
      } else {
        html += " ";
      }
      html += s.html;
    }
    if (openPara !== null) html += "</p>";
    if (page === pageCount() - 1) html += `<p class="end">The end.</p>`;
    if (!total) html = `<p class="message">This book is empty.</p>`;
    pageEl.innerHTML = html;

    prevBtn.disabled = page === 0;
    nextBtn.disabled = page >= pageCount() - 1;
    pageNum.textContent = `Page ${page + 1} of ${pageCount()}`;
    store.set(progressKey, { index: start, total });
    if (focus) window.scrollTo({ top: 0 });
  }

  function go(delta) {
    const page = Math.min(pageCount() - 1, Math.max(0, currentPage() + delta));
    index = page * settings.spp;
    draw({ focus: true });
  }

  prevBtn.addEventListener("click", () => go(-1));
  nextBtn.addEventListener("click", () => go(1));

  readerKeyHandler = (e) => {
    if (e.target.closest("input, textarea, select, [popover]") || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); go(1); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(-1); }
  };
  document.addEventListener("keydown", readerKeyHandler);

  // Swipe left/right on touch screens.
  let touchX = null;
  pageEl.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  pageEl.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
  });

  onSppChange = () => draw();
  settingsBtn.hidden = false;

  draw();
  app.focus({ preventScroll: true });
}

route();
