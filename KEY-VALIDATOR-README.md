# API Key Validation & Organization System

## Quick Start

```bash
npx ts-node key-validator.ts
```

The system will:
1. Test all API keys (OpenRouter + Gemini) for validity
2. Categorize them: valid/invalid/expired/rate-limited
3. Reorganize .env with valid keys at top, invalid keys below
4. Generate detailed reports in .key-validation-logs/
5. Backup original .env to .env.backup-<timestamp>

## What Gets Generated

- **report-<timestamp>.txt** — Human-readable validation report with summary stats
- **validation-<timestamp>.json** — Full JSON results for programmatic access
- **.env.backup-<timestamp>** — Backup of original .env file
- **.env** — Reorganized with valid keys at top

## Example Output

```
[openrouter] Validating 9 keys...
  sk-or-v1-744...a098 ... valid (456ms)
  sk-or-v1-276...d92 ... valid (892ms)
  sk-or-v1-3a5...8af ... invalid (500ms, HTTP 401)

[gemini] Validating 6 keys...
  AIzaSyAB...LTNY ... valid (1023ms)
  AIzaSyCW...DRg ... rate_limited (2001ms, HTTP 429)
```

## .env After Reorganization

```env
# VALID KEYS - Ready for Production Use
PROVIDER_KEYS_NVIDIA_NEMOTRON_3_SUPER_120B_A12B_FREE=sk-or-v1-744...,sk-or-v1-276...
GEMINI_API_KEYS=AIzaSyAB...,AIzaSyCW...

# INVALID / EXPIRED / RATE LIMITED KEYS
# [EXPIRED] sk-or-v1-3a5...
#   Error: HTTP 401: Invalid API key
```

## Adding New Keys

1. Add keys to appropriate section in .env
2. Run: `npx ts-node key-validator.ts`
3. Valid keys auto-move to top section

## Replacing Invalid Keys

1. Get new keys from [OpenRouter](https://openrouter.ai/keys) or [Gemini](https://ai.google.dev/)
2. Replace invalid entries in .env
3. Re-run validator

## Validation Details

**OpenRouter**: Tests via `/chat/completions` endpoint
**Gemini**: Tests via `/generateContent` endpoint
**Timeout**: 15 seconds per key
**Concurrency**: 3 keys tested simultaneously
**Rate Limit Wait**: 2 seconds between provider groups

## Logs

Access validation history:
```bash
# View all valid keys from latest run
jq '.results[] | select(.status == "valid")' \
  .key-validation-logs/validation-*.json | tail -12

# Find invalid keys
jq '.results[] | select(.status != "valid")' \
  .key-validation-logs/validation-*.json
```

## Integration

Works seamlessly with existing ProviderKeyManager:
- Valid keys auto-reload via `/api/admin/provider-keys/load-env`
- Health checks validate keys every 5 minutes
- Degraded keys logged for replacement

## For Detailed Documentation

See: `KEY-VALIDATOR-DETAILED.md`
