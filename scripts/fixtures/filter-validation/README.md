Drop real validation fixtures here to supplement the built-in synthetic corpus.

Supported formats:
- `.jpg`
- `.jpeg`
- `.png`
- `.webp`

If this folder is empty, `pnpm --filter @workspace/scripts validate:filters` falls back to synthetic fixtures so the validation framework still runs in CI and local development.
