# Dyslexic Reader

A simple book reader that uses the [OpenDyslexic](https://opendyslexic.org/) font.

- Choose a book from the landing page (titles come from the first line of each Markdown file).
- Adjust text size, line spacing and how many sentences appear per page.
- Light, dark and automatic themes.
- Your place in each book is remembered in your browser.
- Use the arrow keys or swipe to turn pages.

## Adding a book

Add a Markdown file to `books/`. The first line is the title:

```markdown
# My Story

The first paragraph of the story...

## Chapter two

More text...
```

Supported: paragraphs, `##` headings, `---` scene breaks, `*italic*` and `**bold**`.

Push to `main` and GitHub Actions rebuilds the book list and deploys to GitHub Pages.

## Running locally

```sh
node scripts/build-manifest.mjs   # generates books/index.json
python3 -m http.server 8000       # then open http://localhost:8000
```

## One-time GitHub setup

In the repository settings, go to **Settings → Pages** and set **Source** to **GitHub Actions**.

## Licence

The OpenDyslexic font files in `fonts/` are licensed under the SIL Open Font License (see `fonts/OFL.txt`).
