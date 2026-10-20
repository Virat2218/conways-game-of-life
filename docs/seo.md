# Search and sharing handoff

The simulator is a static GitHub Pages project at
<https://adisakshya.github.io/conways-game-of-life/>. Search indexing and rankings
are decided by search engines; these changes do not guarantee either.

## What the site supplies

- A descriptive title, description and a single absolute canonical URL.
- An expandable, user-visible About & rules section in the original HTML, including
  accurate rules, simultaneous updates, pattern examples and the finite wrapping board.
  The section can be opened without JavaScript; the simulator itself requires JavaScript.
- Minimal WebApplication JSON-LD describing the free educational app. It makes no
  ratings or rich-result claims.
- Open Graph / X metadata, a 1200×630 PNG preview, an SVG favicon, 48×48 PNG fallback
  and 180×180 touch icon. The preview uses the existing simulator screenshot at
  `docs/screenshots/30-initial-desktop-dark.png`; no external image service is used.
- `sitemap.xml` with the one public canonical page. Shared-pattern hashes are board
  data on that page, not separate indexable pages. No invented `lastmod` timestamps.
- Explicit asset inclusion in `.github/workflows/pages.yml`.

## Owner steps after the PR is merged and Pages deployment succeeds

1. In [Google Search Console](https://search.google.com/search-console/), add a
   **URL-prefix** property for `https://adisakshya.github.io/conways-game-of-life/`.
   Use an offered verification method you control. If using an HTML tag or file,
   supply Google's real token/file in a follow-up change; none is fabricated here.
   A github.io domain property needs DNS control that project owners generally lack.
2. Submit `https://adisakshya.github.io/conways-game-of-life/sitemap.xml` in Sitemaps.
3. Inspect the homepage with URL Inspection, run the live test and request indexing.
   Confirm the rendered content, indexability and Google's selected canonical.
4. Monitor Page indexing and Performance for impressions, clicks, CTR and query
   positions. Look at relevant queries such as "Conway's Game of Life simulator",
   "play Game of Life online" and "Gosper glider gun simulator". Positions vary by
   query and context; no fixed timetable or first-page result is promised.
5. Once deployed, preview the shared URL on the platforms you use. Previously
   cached link cards may need refreshing in that platform's inspection tools.

### Origin-root robots.txt

Crawling directives come from `https://adisakshya.github.io/robots.txt`, **not**
`/conways-game-of-life/robots.txt`. Do not add a misleading project-level file.
If the origin file blocks this project, its owner must update the root user-site
repository (`adisakshya.github.io`) separately. This PR does not modify that repo.
Audit on 20 October 2026: the origin robots.txt returned HTTP 200 with
`User-agent: *`, `Allow: /` and a sitemap for `https://adisakshya.codes/sitemap.xml`.
It did not block this project. Submit this project's sitemap directly in Search
Console; an optional additional root Sitemap directive requires a separate owner change.
The homepage returned HTTP 200 with no `X-Robots-Tag` restriction observed.
A missing robots.txt (HTTP 404) does not itself prevent crawling. Verify the live
response after deployment, including any `X-Robots-Tag` header.

## Validation

Run `node --test`. The site tests check asset paths, metadata/JSON-LD consistency,
PNG dimensions and sitemap content, and exercise the same packaging script that
GitHub Pages uses. Check the actual deployment after merge: successful local tests
do not establish that Google has crawled, indexed or ranked the page.

Use browser checks at 360, 768 and 1440 px in both themes when available. The
educational section should remain below the simulator and use the existing theme
tokens. Do not add heavy SEO plugins, analytics or third-party fonts to chase scores.
Lighthouse and structured-data validators can provide diagnostics, not ranking
predictions. A WebApplication schema need not qualify for a Google rich result.

## Responsible discovery

The repository README links the demo. Owner-approved contextual links from the
GitHub profile, personal website or a useful walkthrough can help people discover
it. No external posts, backlink purchases or automated submissions are part of
this PR. Do not add meta-keywords, hidden keyword text or duplicate doorway pages.

## Primary references

- [Google SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)
- [JavaScript SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- [Canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Building a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Structured data guidelines](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
