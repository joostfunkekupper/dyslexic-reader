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
  hyphens: store.get("hyphens", false) === true,
};

// Fixed column widths, independent of text size (bigger text wraps onto more lines); null = whole window.
const WIDTHS = { narrow: "40rem", medium: "52rem", wide: "72rem", full: null };
if (!(settings.width in WIDTHS)) settings.width = "medium";

function applyReadingVars() {
  const root = document.documentElement.style;
  root.setProperty("--reading-size", settings.size + "px");
  root.setProperty("--reading-lh", String(settings.lh));
  root.setProperty("--column-width", WIDTHS[settings.width] ?? "none");
  document.documentElement.classList.toggle("hyphenate", settings.hyphens);
}
applyReadingVars();

// ---------- Reading settings panel (in the toolbar, shown while reading) ----------

const settingsBtn = document.getElementById("settings-toggle");
const brand = document.querySelector(".brand");
const bookNav = document.querySelector(".book-nav");
const bookTitle = document.querySelector(".book-title");

// Pager footer (fixed at the bottom while reading). The open book sets turnPage.
const pagerBar = document.querySelector(".pager-bar");
const prevBtn = pagerBar.querySelector(".prev");
const nextBtn = pagerBar.querySelector(".next");
const pageNum = pagerBar.querySelector(".page-num");
let turnPage = () => {};
prevBtn.addEventListener("click", () => turnPage(-1));
nextBtn.addEventListener("click", () => turnPage(1));

// Show the fade above the footer only when there's more text below.
function updateFade() {
  const more = app.scrollHeight - app.clientHeight - app.scrollTop > 1;
  pagerBar.classList.toggle("more", more);
}
app.addEventListener("scroll", updateFade, { passive: true });
const fadeObserver = new ResizeObserver(updateFade);
fadeObserver.observe(app);
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

const hyphensToggle = document.getElementById("hyphens");
hyphensToggle.checked = settings.hyphens;
hyphensToggle.addEventListener("change", () => {
  settings.hyphens = hyphensToggle.checked;
  store.set("hyphens", settings.hyphens);
  applyReadingVars();
});

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
  app.scrollTop = 0;
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

  // Group by reading level, easiest first (the manifest is already sorted).
  for (const level of [...new Set(books.map((b) => b.level ?? 0))].sort((a, b) => (a || 99) - (b || 99))) {
    const section = document.createElement("section");
    const info = LEVELS[level];
    const heading = document.createElement("h2");
    heading.className = "level-heading";
    if (info) {
      heading.append(levelDots(level), ` Level ${level} · ${info}`);
    } else {
      heading.textContent = "Other books";
    }
    const ul = document.createElement("ul");
    for (const book of books.filter((b) => (b.level ?? 0) === level)) ul.append(bookCard(book));
    section.append(heading, ul);
    list.append(section);
  }
}

const LEVELS = { 1: "First words", 2: "Early reader", 3: "Growing reader" };

function levelDots(level) {
  const dots = document.createElement("span");
  dots.className = "level-dots";
  dots.setAttribute("aria-hidden", "true");
  dots.textContent = "●".repeat(level) + "○".repeat(3 - level);
  return dots;
}

function bookCard(book) {
  const li = document.createElement("li");
  const a = document.createElement("a");
  a.href = "#/read/" + encodeURIComponent(book.slug);
  const name = document.createElement("span");
  name.className = "book-name";
  name.textContent = book.title;

  const meta = document.createElement("span");
  meta.className = "book-meta";
  const parts = [];
  if (book.words) parts.push(`${book.words} words`);
  const pos = store.get("progress:" + book.slug, null);
  if (pos && pos.total) {
    const pct = Math.min(99, Math.round(((pos.index + 1) / pos.total) * 100));
    parts.push(pos.end ? "Finished" : `${pct}% read`);
  }
  meta.textContent = parts.join(" · ");

  a.append(name, meta);
  li.append(a);
  return li;
}

// ---------- Confetti ----------

const CONFETTI_COLOURS = ["#f94144", "#f8961e", "#f9c74f", "#90be6d", "#43aa8b", "#577590", "#c77dff"];

function celebrate() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.querySelector(".confetti")?.remove();

  const canvas = document.createElement("canvas");
  canvas.className = "confetti";
  canvas.setAttribute("aria-hidden", "true");
  document.body.append(canvas);
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = innerWidth;
  const h = innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  // Two bursts, from the bottom-left and bottom-right corners, aimed up and inwards.
  const pieces = Array.from({ length: 160 }, (_, i) => {
    const fromLeft = i % 2 === 0;
    const angle = (fromLeft ? -60 : -120) + (Math.random() - 0.5) * 50;
    const speed = (15 + Math.random() * 9) * Math.sqrt(h / 700);
    return {
      x: fromLeft ? 0 : w,
      y: h,
      vx: Math.cos((angle * Math.PI) / 180) * speed,
      vy: Math.sin((angle * Math.PI) / 180) * speed,
      sway: Math.random() * Math.PI * 2,
      size: 6 + Math.random() * 6,
      spin: Math.random() * Math.PI,
      spinSpeed: (Math.random() - 0.5) * 0.3,
      colour: CONFETTI_COLOURS[i % CONFETTI_COLOURS.length],
      round: Math.random() < 0.3,
    };
  });

  const start = performance.now();
  const duration = 5000;
  function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = Math.max(0, Math.min(1, (duration - t) / 800));
    for (const p of pieces) {
      // Shoot up fast, then drift down slowly with a little side-to-side sway.
      p.vy = Math.min(p.vy + 0.35, 1.8);
      p.vx *= 0.97;
      p.sway += 0.05;
      p.x += p.vx + Math.sin(p.sway) * 0.8;
      p.y += p.vy;
      p.spin += p.spinSpeed;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin);
      ctx.fillStyle = p.colour;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Scale on one axis so the paper looks like it flutters.
        ctx.scale(1, Math.cos(p.spin * 2));
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      }
      ctx.restore();
    }
    if (t < duration && canvas.isConnected) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}

// ---------- Reader ----------

// The extra page shown after the last page of text. The link looks like a button
// and carries an open-book icon.
const END_PAGE_HTML = `<div class="the-end">
  <p>The end.</p>
  <a class="end-link" href="#/"><svg aria-hidden="true" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.5C10.5 5 8.5 4.5 6 4.5H3v13h3c2.5 0 4.5.5 6 2 1.5-1.5 3.5-2 6-2h3v-13h-3c-2.5 0-4.5.5-6 2Z"/><path d="M12 6.5v13"/></svg>Choose another book</a>
</div>`;

let readerKeyHandler = null;

function cleanupReader() {
  if (readerKeyHandler) document.removeEventListener("keydown", readerKeyHandler);
  readerKeyHandler = null;
  onSppChange = () => {};
  settingsBtn.hidden = true;
  bookNav.hidden = true;
  brand.hidden = false;
  turnPage = () => {};
  pagerBar.hidden = true;
  fadeObserver.disconnect();
  fadeObserver.observe(app);
  if (settingsPanel.matches(":popover-open")) settingsPanel.hidePopover();
}

async function renderReader(slug) {
  cleanupReader();
  app.replaceChildren(document.getElementById("reader-tpl").content.cloneNode(true));
  const $ = (sel) => app.querySelector(sel);
  const pageEl = $(".page");

  let book;
  try {
    book = await loadBook(slug);
  } catch (err) {
    pageEl.innerHTML = `<p class="message">${escapeHtml(err.message)}.</p>`;
    return;
  }

  const title = book.title || book.meta.title;
  bookTitle.textContent = title;
  bookTitle.title = title;
  brand.hidden = true;
  bookNav.hidden = false;
  document.title = `${title} · Dyslexic Reader`;

  const total = book.sentences.length;
  const progressKey = "progress:" + slug;
  // Position is tracked by sentence, so changing sentences-per-page keeps your place.
  const saved = store.get(progressKey, { index: 0 });
  let index = Math.min(saved.index || 0, Math.max(0, total - 1));
  // After the text there is one extra "The end." page.
  let atEnd = Boolean(saved.end && total);

  const textPages = () => Math.max(1, Math.ceil(total / settings.spp));
  const pageCount = () => textPages() + (total ? 1 : 0);
  const currentPage = () => (atEnd ? textPages() : Math.floor(index / settings.spp));

  function draw({ focus = false } = {}) {
    const page = currentPage();
    const start = Math.min(page * settings.spp, total);
    const slice = atEnd ? [] : book.sentences.slice(start, start + settings.spp);

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
    if (atEnd) html = END_PAGE_HTML;
    if (!total) html = `<p class="message">This book is empty.</p>`;
    pageEl.innerHTML = html;

    prevBtn.disabled = page === 0;
    nextBtn.disabled = page >= pageCount() - 1;
    pageNum.textContent = `Page ${page + 1} of ${pageCount()}`;
    store.set(progressKey, { index: atEnd ? index : start, total, end: atEnd });
    if (focus) app.scrollTo({ top: 0 });
    updateFade();
  }

  function go(delta) {
    const before = currentPage();
    const page = Math.min(pageCount() - 1, Math.max(0, before + delta));
    atEnd = Boolean(total) && page === textPages();
    if (!atEnd) index = page * settings.spp;
    draw({ focus: true });
    // Celebrate when turning onto the "The end." page.
    if (atEnd && page !== before) celebrate();
  }

  turnPage = go;
  pagerBar.hidden = false;
  fadeObserver.observe(pageEl);

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
