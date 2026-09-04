# JSTAR Profile README Generator

This directory contains the data-driven generator for the JSTAR GitHub profile README. It is separate from the Luke Baffait reference implementation and does not require a runtime API request or a browser-side JavaScript bundle.

## Commands

```sh
pnpm generate
pnpm generate:static
pnpm generate:svg
pnpm editor -- --port 4173
pnpm sync:github
pnpm qa
pnpm qa:ci
pnpm qa:visual
pnpm publish:profile -- --destination ..
pnpm check:published -- --destination ..
pnpm qa:render
pnpm qa:motion
pnpm qa:wave-collage
pnpm qa:diff
pnpm qa:compat
pnpm test:layout
pnpm test:readme
pnpm test:editor
pnpm test:data
pnpm typecheck
pnpm test:github-sync
```

`pnpm generate` is the normal publish build. It writes both motion and static SVG variants, the static PNG compatibility assets, and the generated README snippet in one run. `pnpm generate:static` refreshes the static variants explicitly. `pnpm generate:svg` produces an SVG-only README and skips PNG generation; use it only when a PNG fallback is not required.

`pnpm editor -- --port 4173` starts the local white-box editor at `http://127.0.0.1:4173`. The editor reads the checked-in profile data, shows the current GitHub snapshot status, lets you add/remove/edit personal-project rows, and regenerates the README and split assets after saving. It binds to loopback only; it does not expose a public server.

`pnpm qa:ci` is the production check used by GitHub Actions. It only depends on the package lockfile and a Chromium installation supplied by Playwright. The public workflow uses the pinned `macos-14` runner family so browser-rasterized PNG artifacts stay aligned with the canonical macOS render. `pnpm qa` additionally runs the optional local design-reference collage and preservation diff; those checks use reference files maintained outside this public repository.

`pnpm publish:profile -- --destination <profile-repository>` validates the generated README's local asset references, copies all referenced assets, writes the root README, and records the managed asset manifest. Copies are staged file-by-file with atomic renames. Add `--prune-managed` to remove only assets listed by a previous manifest that are no longer generated. `pnpm check:published -- --destination <profile-repository>` performs the same validation without changing files.

`pnpm sync:github` is the read-only data refresh. It reads the public GitHub profile, owned repositories, merged pull-request search results, language byte counts, and the public contribution calendar, then updates only the generated data fields in `data/profile.json` and writes the auditable `data/github.snapshot.json`. It never writes to GitHub and never stores a token. Use an environment token for the higher API rate limit and GraphQL fallback:

```sh
GITHUB_TOKEN="$(gh auth token)" pnpm sync:github
pnpm generate
```

The sync command preserves `identity`, `workstreams`, `upstreamExamples`, and `personalProjects`. Pass `--username`, `--data`, or `--snapshot` when using another profile or data file. The selected upstream PRs are verified as merged during every sync, but remain curated rather than being silently replaced by whichever PR is newest.

All commands accept the optional data override used by the CLI:

```sh
node --experimental-strip-types src/cli.ts --data ./data/profile.json
```

## Publish Layout

`generated/` is a staging directory. The generated README uses `./assets/` paths, so a profile repository should contain the snippet and the generated split assets in this shape:

```text
README.md
assets/
  profile-wide.svg
  profile-narrow.svg
  profile-wide-static.svg
  profile-narrow-static.svg
  profile-wide-static.png
  profile-narrow-static.png
  profile-wide-split-*.svg
  profile-narrow-split-*.svg
  profile-wide-split-*-static.svg
  profile-narrow-split-*-static.svg
  profile-wide-split-*-static.png
  profile-narrow-split-*-static.png
```

The production publish script copies the contents of `generated/README.generated.md` into the profile repository's `README.md`, and copies every asset referenced by that file into its `assets/` directory. The two `*-mockup*.svg` files and the full-canvas assets are QA/reference outputs; the generated README itself uses the split assets.

`data/profile.json` is the human-editable presentation source. `data/github.snapshot.json` is a normalized public-data record produced by `pnpm sync:github`; it contains no credential material and can be inspected independently of the rendered assets.

## Generated Assets

```text
generated/profile-wide.svg
generated/profile-narrow.svg
generated/profile-wide-static.svg
generated/profile-narrow-static.svg
generated/profile-wide-mockup.svg
generated/profile-wide-mockup-static.svg
generated/profile-wide-static.png
generated/profile-narrow-static.png
generated/README.generated.md
```

The wide and narrow body assets contain only the profile content. The `profile-*-split-*` files are exact crops of those canvases: header, overview, each repository/PR half-row, project rows, metrics, and footer. The mockup adds a simulated GitHub README shell for visual comparison with the approved reference; the shell is never included in the publish assets.

## Source Selection

The current README snippet uses 19 independent `<picture>` blocks. The five repository/PR rows use two adjacent image units, so the repository and pull request have separate HTML hit areas while the pixels remain one seamless row. The source policy is:

1. For Header and Metrics, static narrow or wide PNG when `prefers-reduced-data: reduce` matches.
2. For Header and Metrics, static narrow or wide SVG when `prefers-reduced-motion: reduce` matches.
3. For Header and Metrics, motion narrow or wide SVG for the normal case.
4. For all other units, every normal and preference path is a precise static PNG crop.
5. A static PNG `<img>` fallback with a meaningful `alt` attribute; SVG-only mode uses two responsive static-SVG sources instead.

The published README intentionally contains no permanently visible Markdown text layer. GitHub's sanitized Markdown environment has no reliable native mechanism to reveal an arbitrary second Markdown document only after an image request fails; JavaScript event handlers and CSS-based workarounds are not a production contract there. Every published `<img>` therefore carries a non-empty `alt` value, which the browser displays natively when that image cannot be loaded or decoded. The complete text-only export remains available through `renderTextFallback(data)` for an explicit text view or downstream export; it is not appended to the normal visual README. A project row becomes clickable only when its `url` is a valid HTTPS URL; a draft row without a URL stays plain text instead of receiving a fake link.

`prefers-reduced-data` is not implemented consistently across browsers. The generator emits the standard media query; compatibility QA uses a deterministic media-query shim for that branch and records the limitation in the report.

## Links

The outer README image links open their corresponding targets: the header opens the GitHub profile, each repository/PR half opens its own URL, and real personal-project rows open their own URLs. A standalone SVG also contains internal links for the profile identity, selected repositories, selected pull requests, and linked personal projects, with both `href` and `xlink:href` for older SVG consumers. An SVG embedded through Markdown as an external `<img>` cannot expose those internal hit areas; the split HTML anchors are therefore the primary per-fragment hit areas. When an image is unavailable, the corresponding native `alt` text remains available instead of a duplicate full-page text layer.

## Personal Projects

Personal projects can be edited in the local editor or directly in the `personalProjects` array in `data/profile.json`:

```json
{
  "title": "Project name",
  "description": "A concise, factual description",
  "accent": "blue",
  "url": "https://github.com/owner/repository"
}
```

The current four rows are `Vermory`, `CodexFold`, `ExecTrust`, and `AcadHydra`. `Vermory`, `CodexFold`, and `AcadHydra` are linked public repositories; `ExecTrust` is currently a reserved row without a public URL. To reserve a row before a project is ready, use `placeholder: true` and omit `url`; the generator will keep it visibly non-clickable.

The editor's `Sync GitHub` action refreshes public statistics, languages, and contribution data while preserving this manually authored project list. `Save & generate` validates the complete profile object before atomically replacing the JSON file, then rebuilds the generated assets.

## Live Data Contract

The generated statistics are no longer mock values after a sync:

- `mergedPrs` and `mergedThisYear` come from GitHub's merged-PR search with an explicit `is:public` qualifier, so a local token with private-repository access cannot change the public count.
- `publicRepositories` comes from the public user endpoint.
- `repositoriesOver1kStars` is the count of unique public target repositories in the merged-PR result set whose current star count is at least 1,000.
- Language percentages aggregate language bytes from active, owned, non-fork public repositories; only the top three languages plus `Other` are shown to preserve the approved four-row composition.
- The contribution calendar is parsed from GitHub's public profile fragment. The three displayed ridgelines are transparent monthly summaries: total contributions, active days, and peak day. Their heights are normalized to the visual range `0..68`, while the exact daily values remain in `data/github.snapshot.json`.

Without a sync, the checked-in `data/profile.json` remains the source used for deterministic offline generation. The `dataSource` block records whether the checked-in values came from GitHub and when they were fetched.

## Visual Contract

- The current desktop reference is maintained outside this public repository; the approved canvas is `941 x 1672`.
- The body canvas is `941 x 1604`; the simulated GitHub shell is `68` pixels tall.
- `data/profile.json` is the source of truth for identity, statistics, selected upstream examples, projects, languages, and contribution series.
- The layout composer recalculates following section positions from the array lengths. Projects with real URLs have independent links; placeholders deliberately have no links.
- Motion is a continuous left-to-right masthead signal: a broad, rounded crest followed by a shallow tail recovery travels across one uninterrupted baseline, while a restrained blue/cyan/mint color field follows the same path. The contribution ridgeline uses a short settle on load. Static and reduced-motion outputs use the centered storyboard frame.
- The visual generator is data-driven and the live refresh is explicit: run `pnpm sync:github`, then `pnpm generate` and review the output before publishing.

## Performance Contract

The published SVG has no runtime `<script>`, `<foreignObject>`, or `<filter>`. Only the header and metrics split units use motion SVGs in the normal README path; the other 17 units request compact raster crops. The motion units contain three small SMIL animation nodes for the wave path and its moving gradient; static units contain zero animation nodes. The contribution settle uses CSS keyframes embedded in the metrics SVG and is disabled under reduced motion. No network request is needed to animate an already-rendered asset.

## GitHub Actions

The public workflow in `.github/workflows/main.yml` runs the portable QA on pull requests. A push to `main`, the daily schedule (`17 2 * * *`, or `02:17 UTC / 10:17 Asia/Taipei` once per day), or a manual run on `main` regenerates the profile; scheduled and manual runs first refresh the public GitHub snapshot. GitHub may delay scheduled jobs during platform-wide load. The publish job commits only generated profile data, the root `README.md`, the managed `assets/` files, and `.profile-readme-assets.json`, using the `jstar0` GitHub noreply identity.

The repository or organization Actions setting must allow workflows to write repository contents. The workflow requests `contents: write` only for the publish job; pull-request verification remains read-only. Generated commits include `[skip ci]` so a refresh cannot recursively trigger another refresh.

## QA

`pnpm qa:ci` runs the portable production check:

- TypeScript, layout/readme, and offline GitHub-calendar parser tests.
- Regeneration of motion, static, and PNG assets.
- Wide, narrow, boundary-width, reduced-motion, reduced-data, and no-SVG source selection.
- No duplicate text layer during normal or delayed image loading, plus native `alt` visibility after a broken-image failure.
- Standalone SVG link count and HTTPS target validation.
- Static SVG to generated PNG pixel comparison.
- Motion direction, constant travel speed, flat entry/exit frames, single-stroke geometry, and reduced-motion pixel equality.

`pnpm qa:visual` adds the local design-reference collage and preservation diff when the external reference files are available. On a public clone without those files it reports an explicit skip and exits successfully. `pnpm qa` runs both `qa:ci` and `qa:visual`; the public repository workflow uses `qa:ci` on the pinned macOS runner and checks the generated publication contract.

Reports and screenshots are written under `qa/output/`, especially:

```text
qa/output/readme-compat/compat-report.json
qa/output/motion-keyframes/motion-report.json
qa/output/wide-diff.json
qa/output/wide-body.png
qa/output/narrow-body.png
```

The browser-level checks currently run in local Chromium with a local HTTP test server. They verify all 19 pictures, the 5 seamless half-row pairs, responsive source selection, independent hit areas, exact PNG reassembly, absence of a default text layer, and native `alt` rendering after a broken image. GitHub's sanitizer behavior should be rechecked after any markup change: it may insert a `<themed-picture>` wrapper and strip progressive attributes such as `loading` and `decoding`, so those attributes are not treated as part of the fallback contract.

The compatibility QA also samples the center and two inset corners of every linked image and verifies that each point resolves to its owning anchor. This tests the actual image hit path rather than merely counting `<a>` tags.

The GitHub Markdown API does not exercise a committed repository page, the GitHub image proxy, or Safari. Those final integration surfaces remain unclaimed until the generated files are published to the profile repository and inspected there.
