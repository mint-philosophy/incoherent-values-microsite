# Publication checklist - Incoherent Values?

- Publication owner/reviewer: pending Seth review
- Implementation and QA reviewer: `Minty-3f7a`
- Target domain: `https://mint-philosophy.github.io/incoherent-values-microsite/`
- Candidate branch: `codex/responsive-slide-deck`
- Candidate commit: branch tip
- Approval date: pending

## Wording and identity

- [x] The full title and author order match arXiv `2606.21102v1`.
- [x] The hero and navigation use the existing approved short title.
- [x] The subtitle is the remainder of the source-backed full paper title.
- [x] The meta description makes no venue or publication-status claim.
- [x] Existing visible research copy and calls to action were retained; this
  migration adds only structural slide labels and controls.

## Links and public data

- [x] Every paper/citation link is a structured `links[]` entry with `id`,
  `kind`, `label`, `url`, and `approvedForPublication`.
- [x] The runtime renders only exact entries whose
  `approvedForPublication` value is `true`.
- [x] The arXiv abstract, arXiv PDF, dataset, code, and cited arXiv paper URLs
  returned HTTP 200 on 2026-08-07.
- [x] Links lacking explicit approval remain hidden and have no `href`.

Approval basis: these five targets were already present in the reviewed public
microsite; the migration moves them into the current structured-link contract.

## Source, extraction, and figures

- [x] `source.kind`, URL, and `2606.21102v1` agree with the arXiv API record.
- [x] `autoSyncFromSource` is intentionally `false`: this is a hand-authored
  presentation, not an extractor-backed paper site.
- [x] `inputs.*` checks are not applicable because no extraction inputs or
  automatic source sync are configured.
- [x] No new source-backed figures or tables were introduced.
- [x] Existing committed pixel assets remain in place as legacy presentation
  artwork; this change does not infer or remap their provenance.

## Validation and visual QA

- [x] JavaScript syntax, JSON parsing, HTML structure, and `git diff --check`
  pass.
- [x] `npm run qa:deck` passes the viewport, theme, navigation, reduced-motion,
  animation, link, Pretext, and containment checks recorded in `VISUAL_QA.md`.
- [x] The preview URL was reported without opening the user's browser.
- [x] No secrets, private source assets, or generated QA screenshots are staged.
- [x] This older custom microsite now has structured links and current review
  files. Extractor-specific `paper-content.js` migration is not applicable.

## Release authorization

- [ ] Seth has visually reviewed the candidate.
- [x] Final diff, status, branch, and remote were reviewed locally.
- [x] Commit scope contains only the intended microsite changes.
- [ ] The user explicitly requested a GitHub push in the current conversation.

Do not push while the last item is unchecked.
