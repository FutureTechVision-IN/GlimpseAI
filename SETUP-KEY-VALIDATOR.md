# 🔐 API Key Validation System - Setup & Usage Guide

## What's Included

**Core System** (504 lines):
- `key-validator.ts` — Main validation script

**Execution Tools**:
- `validate-keys.sh` — Shell script wrapper (executable)
- `key-validator-package.json` — npm dependencies

**Documentation** (454 lines):
- `KEY-VALIDATOR-README.md` — Quick start guide
- `KEY-VALIDATOR-DETAILED.md` — Technical reference

**Examples**:
- `.env.example` — Sample organized .env structure

## Quick Start (30 seconds)

```bash
# Run validation
npx ts-node key-validator.ts

# Or use shell script
bash validate-keys.sh
```

That's it! The system will:
1. ✅ Test all OpenRouter and Gemini API keys
2. ✅ Categorize them: valid/invalid/expired
3. ✅ Reorganize .env (valid keys at top)
4. ✅ Generate detailed reports in `.key-validation-logs/`
5. ✅ Backup original .env to `.env.backup-*`

## What Happens

### Before (Random order)
```env
PROVIDER_KEYS_NVIDIA_...=key1,key2,key3
GEMINI_API_KEYS=key4,key5,key6
```

### After Validation
```env
# Valid keys at top (grouped by provider/model)
PROVIDER_KEYS_NVIDIA_...=key1,key2
GEMINI_API_KEYS=key4,key5

# Invalid keys commented below with error details
# [EXPIRED] key3 - HTTP 401: Invalid API key
# [INVALID] key6 - HTTP 403: Forbidden
```

## Generated Output

Each run generates 4 files:

1. **report-<timestamp>.txt** — Human readable report
   ```
   Total Keys: 15
   Valid: 12
   Expired: 2
   Invalid: 1
   Avg Latency: 847ms
   ```

2. **validation-<timestamp>.json** — Full data (programmatic)
   ```json
   {
     "results": [
       {
         "key": "sk-or-v1-...",
         "status": "valid",
         "latencyMs": 456
       }
     ]
   }
   ```

3. **.env.backup-<timestamp>** — Original .env backup

4. **.env** — Reorganized version

## Common Tasks

### Add New API Keys

1. Get keys from:
   - OpenRouter: https://openrouter.ai/keys
   - Gemini: https://ai.google.dev/

2. Add to `.env`:
   ```env
   PROVIDER_KEYS_NVIDIA_NEMOTRON_3_NANO_30B_A3B_FREE=new-key-1,new-key-2
   GEMINI_API_KEYS=new-gemini-key
   ```

3. Run validator:
   ```bash
   npx ts-node key-validator.ts
   ```

4. Valid keys automatically move to top section

### Replace Invalid Keys

1. Get replacement keys from provider
2. Replace invalid entry in `.env`
3. Re-run validator

The validator automatically:
- Tests new keys
- Moves valid ones to top
- Comments invalid ones below

### View Validation History

```bash
# View all valid keys from latest run
jq '.results[] | select(.status == "valid")' \
  .key-validation-logs/validation-*.json | tail -20

# Find all invalid keys with errors
jq '.results[] | select(.status != "valid") | {key: .keyPrefix, error: .errorMessage}' \
  .key-validation-logs/validation-*.json
```

### Check System Integration

```bash
# Once .env is organized, start the API server:
cd artifacts/api-server
npm run dev

# Server will load valid keys automatically
# GET http://localhost:3000/api/admin/provider-keys/status

# Should show all valid keys loaded
```

## Validation Strategies

### What Gets Tested

**OpenRouter Keys**:
- Endpoint: `POST /chat/completions`
- Test: Send minimal message with `max_tokens: 1`
- Result: Latency measured, status recorded

**Gemini Keys**:
- Endpoint: `POST /generateContent`
- Test: Send minimal content generation request
- Result: Latency measured, status recorded

### Status Codes

| Code | Meaning | Action |
|------|---------|--------|
| 200 | Valid | ✅ Use it |
| 401 | Auth failed | ❌ Revoked/expired |
| 403 | Forbidden | ❌ Invalid |
| 429 | Rate limited | ⚠️ Retry later |
| Timeout | Too slow | ❌ Invalid |

### Concurrency

- Tests 3 keys simultaneously
- 2-second delay between providers
- ~3-5 minutes for 12 keys total

## Security Notes

⚠️ **Sensitive Data**:
- `.key-validation-logs/validation-*.json` contains full keys
- `.env.backup-*` files contain full keys
- `.env` contains full keys

**Protect these files:**
```bash
chmod 700 .key-validation-logs/       # Only owner can read
chmod 600 .env.backup-*               # Only owner can read/write
chmod 600 .env                        # Only owner can read/write
```

**Cleanup old logs:**
```bash
# Keep reports, delete raw logs after 7 days
find .key-validation-logs -name "validation-*.json" -mtime +7 -delete
```

## Integration with Provider Key Manager

The validator works with the existing API:

1. **Load keys**: `POST /api/admin/provider-keys/load-env`
2. **Check status**: `GET /api/admin/provider-keys/status`
3. **Health checks**: Auto-run every 5 minutes

**Workflow:**
```
key-validator.ts reorganizes .env
        ↓
Server starts/reloads
        ↓
ProviderKeyManager loads valid keys only
        ↓
Health checks validate every 5 minutes
        ↓
Expired keys auto-marked "degraded"
        ↓
Next validator run replaces them
```

## Scheduling Periodic Validation

### Option 1: Manual (Weekly)
```bash
# Run manually once a week
npx ts-node key-validator.ts
```

### Option 2: Cron Job (Automated)
```bash
# Add to crontab
0 9 * * 1 cd /path/to/GlimpseAI && npx ts-node key-validator.ts >> validation.log 2>&1
```

### Option 3: GitHub Actions
```yaml
name: Validate API Keys
on:
  schedule:
    - cron: "0 */6 * * *"  # Every 6 hours

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 20
      - run: npx ts-node key-validator.ts
```

## Troubleshooting

### Validator hangs?
- One key is timing out (might be slow provider)
- Wait 30 minutes and try again
- Or comment out Gemini keys temporarily

### "HTTP 429 Too Many Requests"?
- Provider is rate limiting validation
- Wait 15-30 minutes before retrying
- Don't run validator too frequently

### All keys marked invalid?
- Check internet connection
- Check provider status pages (OpenRouter, Gemini)
- Verify .env file format

### .env not updating?
- Check file permissions: `chmod 644 .env`
- Restore from backup: `cp .env.backup-* .env`
- Try again

## File Locations

```
GlimpseAI/
├── key-validator.ts                 # Main script
├── validate-keys.sh                 # Shell wrapper
├── KEY-VALIDATOR-README.md          # Quick start
├── KEY-VALIDATOR-DETAILED.md        # Technical details
├── key-validator-package.json       # Dependencies
├── .env.example                     # Sample structure
├── .env                             # Your actual keys (reorganized)
├── .env.backup-*                    # Backups (auto-created)
└── .key-validation-logs/            # Validation history
    ├── report-*.txt                 # Human readable
    └── validation-*.json            # Full data
```

## Next Steps

1. **Run validator**: `npx ts-node key-validator.ts`
2. **Review report**: Check `.key-validation-logs/report-*.txt`
3. **Check .env**: Should be reorganized with valid keys at top
4. **Replace invalid keys**: If any marked invalid, get replacements
5. **Schedule periodic runs**: Set up weekly or monthly validation
6. **Integrate with server**: Server uses valid keys from .env

## For Advanced Usage

See `KEY-VALIDATOR-DETAILED.md` for:
- Custom provider configuration
- Programmatic API access
- Performance optimization
- Security best practices
- Integration architecture

## Support

**Questions?**
- Check `KEY-VALIDATOR-README.md` for common tasks
- See `KEY-VALIDATOR-DETAILED.md` for technical details
- Review `.key-validation-logs/` for error messages

**Found a bug?**
- Check logs in `.key-validation-logs/validation-*.json`
- Verify key format is correct
- Try re-running validator

---

**Created**: 2026-04-16
**System**: API Key Validation & Organization for GlimpseAI
**Supports**: OpenRouter (Bearer tokens) + Google Gemini (API keys)
