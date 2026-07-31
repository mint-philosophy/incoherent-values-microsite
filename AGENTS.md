# Agent instructions

These rules apply to this template and should be retained in repositories copied
from it.

- Do not invent visible microsite copy. Use the full paper title by default.
  Short hero or navigation titles, subtitles, venue claims, labels, calls to
  action, and summaries require a source or explicit publication approval.
- Treat the hero subtitle as optional. Leave it empty when no approved subtitle
  exists; do not add filler for visual balance.
- Add external links through structured `paper.config.json` entries. A link may
  be emitted or render only when `approvedForPublication` is explicitly `true`.
  A public URL alone is not approval, and committed config must never contain a
  secret URL.
- Map every new figure to an exact `sourceAsset` file relative to
  `inputs.latexDir`. Do not infer figure identity from PDF image order. A legacy
  destination-only entry is acceptable only when its `src` is a real committed
  file with documented provenance; it is not a pattern for new figures. Convert
  PDF/EPS artwork to a reviewed browser image first; source sync does not convert it.
- Describe automatic sync as partial. It can refresh extracted arXiv content and
  configured source assets, but it does not approve or refresh all hand-authored
  display metadata and configured data.
- When starting a local preview, report the URL and let the user open it. Never
  run a command that opens the user's browser automatically.
- Never run `git push` or another GitHub publish action unless the user explicitly
  asks for that push in the current conversation. Before an authorized push,
  inspect the diff, status, branch, and remote.
- Do not imply that an instantiated site follows later template changes
  automatically. Migrate older sites explicitly: add `links: []` when absent,
  merge the compatible runtime/extractor changes, regenerate `PAPER_LINKS`, and
  copy the current agent, publication-checklist, and visual-QA workflow files.
- Complete the publication and visual-QA checklists before recommending release.
