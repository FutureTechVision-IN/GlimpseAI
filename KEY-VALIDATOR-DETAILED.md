# Comprehensive API Key Validation System - Technical Reference

## System Architecture

The validator is a comprehensive system that:

1. **Parses** the .env file to extract all API keys and group them by provider
2. **Validates** each key by making authenticated test requests to provider APIs
3. **Tracks** latency, HTTP status codes, and error messages
4. **Categorizes** results into: valid, expired, invalid, rate-limited, unknown
5. **Reports** findings in both human-readable and JSON formats
6. **Reorganizes** .env with valid keys at top, invalid keys below with details
7. **Backs up** the original .env before making changes
8. **Logs** all validation runs to .key-validation-logs/ for audit trail

## Validation Endpoints

### OpenRouter (Bearer Token)
```
POST https://openrouter.ai/api/v1/chat/completions
Headers: Authorization: Bearer <KEY>
Timeout: 15 seconds
Test Payload: Minimal message with max_tokens: 1
```

**Status Codes:**
- 200 = Valid ✅
- 401/403 = Expired/Invalid ❌
- 429 = Rate Limited ⚠️
- Timeout = Invalid ❌

### Google Gemini (API Key)
```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=<KEY>
Headers: Content-Type: application/json
Timeout: 15 seconds
Test Payload: Minimal generateContent request
```

**Status Codes:**
- 200 = Valid ✅
- 400/401/403 = Invalid ❌
- 429/503 = Rate Limited ⚠️
- Timeout = Invalid ❌

## Running the Validator

### Option 1: Quick (ts-node)
```bash
npx ts-node key-validator.ts
```

### Option 2: Build then run
```bash
npx esbuild key-validator.ts --bundle --platform=node --outfile=key-validator.mjs
node key-validator.mjs
```

### Option 3: Use shell script
```bash
bash validate-keys.sh
```

## Output Files

### report-TIMESTAMP.txt
Human-readable report with:
- Total keys tested
- Summary: valid/expired/invalid/rate-limited counts
- Provider breakdown
- Performance metrics (min/max/avg latency)
- Lists of valid keys
- Lists of invalid keys with error messages

### validation-TIMESTAMP.json
Full JSON results with complete details:
```json
{
  "timestamp": "ISO8601",
  "totalKeys": 15,
  "results": [
    {
      "key": "full-api-key-value",
      "keyPrefix": "masked-key-prefix",
      "provider": "openrouter|gemini",
      "model": "provider-specific-model",
      "status": "valid|invalid|expired|rate_limited|unknown",
      "latencyMs": 456,
      "errorMessage": null,
      "validatedAt": "ISO8601"
    }
  ]
}
```

### .env.backup-TIMESTAMP
Complete backup of original .env file before reorganization

### .env (updated)
Reorganized with structure:
1. Header comment with timestamp
2. VALID KEYS section (grouped by provider/model)
3. INVALID/EXPIRED/RATE LIMITED section (commented with details)

## .env Reorganization Process

### Input (Before)
```env
PROVIDER_KEYS_MODEL_A=key1,key2,key3
GEMINI_API_KEYS=key4,key5,key6
```

### Parsing Phase
- Extract all keys and their providers
- Parse model names from env var names

### Validation Phase
- Send test request for each key
- Record: status, latency, error message

### Categorization Phase
- Group by: provider, model, validation status

### Organization Phase
- Valid section: keys grouped by provider and model
- Invalid section: one comment block per invalid key with error details

### Output (After)
```env
# GlimpseAI API Keys
# Auto-organized on 2026-04-16T23:42:00Z

# ============ VALID KEYS ============
PROVIDER_KEYS_MODEL_A=key1,key2
GEMINI_API_KEYS=key4,key5

# ============ INVALID KEYS ============
# [EXPIRED] key3
#   Error: HTTP 401: Invalid API key
#   Validated: 2026-04-16T23:42:00Z
```

## Concurrency Strategy

The validator processes multiple keys in parallel for efficiency:

1. **Concurrency limit**: 3 keys tested simultaneously per provider
2. **Sequential providers**: OpenRouter tested, then 2-second wait, then Gemini
3. **Why sequential?**: Different rate limits and rate-limiting behavior per provider

**Performance Profile:**
- 12 keys: ~3-5 minutes total (including inter-provider delays)
- Per-key: 900-1500ms (900ms network + test, 600ms margin)

## Error Handling

### Network Errors
- Connection timeout (>15s): Mark as "invalid", log "Request timeout"
- Connection refused: Mark as "invalid", log specific error
- DNS resolution failed: Mark as "invalid", log DNS error

### HTTP Errors
- 4xx (except 429): Mark as "invalid" or "expired"
- 5xx: Mark as "unknown" (may recover later)
- 429 (rate limited): Mark as "rate_limited", NO RETRY

### Format Errors
- Malformed response: Mark as "invalid", log parse error
- Empty response: Mark as "invalid", log "No response"

### Why no retry on rate limit?
- Provider rate limiting is intentional (usage protection)
- Retrying aggressively can trigger security blocks
- Better to mark and review later
- Next validation run will recheck

## Rate Limiting Awareness

The system respects provider rate limits:

1. **Detects 429 status**: Marks key as "rate_limited" (not "invalid")
2. **Waits between providers**: 2 seconds between OpenRouter and Gemini
3. **Limits concurrency**: Only 3 concurrent tests per provider
4. **No aggressive retry**: One test per key per run

This prevents:
- Triggering provider security alerts
- Getting IP-blocked by provider
- Wasting rate limits on validation

## Logging & Audit

All runs logged to `.key-validation-logs/`:
```
.key-validation-logs/
├── report-2026-04-16T23-30-00-000Z.txt
├── validation-2026-04-16T23-30-00-000Z.json
├── report-2026-04-15T17-15-00-000Z.txt
└── validation-2026-04-15T17-15-00-000Z.json
```

**Query logs:**
```bash
# Latest valid keys
jq '.results[] | select(.status == "valid") | .keyPrefix' \
  .key-validation-logs/validation-*.json | sort -V | tail -1 | xargs -I{} \
  jq ".results[] | select(.keyPrefix == {})"

# All rate-limited keys
jq '.results[] | select(.status == "rate_limited")' \
  .key-validation-logs/validation-*.json

# Performance trends
for f in .key-validation-logs/validation-*.json; do
  echo "=== $(basename $f) ===" 
  jq '.results | map(.latencyMs) | {min: min, max: max, avg: (add/length)}' "$f"
done
```

## Security Considerations

**Full keys stored unmasked in:**
- .key-validation-logs/validation-*.json
- .env.backup-* files

**Mitigation:**
- Restrict directory permissions: `chmod 700 .key-validation-logs`
- Restrict file permissions: `chmod 600 .env.backup-*`
- Delete old logs after review: `rm .key-validation-logs/validation-*.json`
- Keep backups for 7 days max, then delete

**Console output is safe:**
- Keys are masked: `sk-or-v1-cda...fc0`
- Only shown masked in human output

## Integration with ProviderKeyManager

The validator works with the existing `ProviderKeyManager` in the API:

1. **Load endpoint**: `/api/admin/provider-keys/load-env`
   - Loads all valid keys from reorganized .env
   - Validates them immediately
   - Starts 5-minute health check loop

2. **Health checks**: Every 5 minutes
   - Re-validates all active keys
   - Marks degraded after 3 consecutive errors
   - Picks random valid key for each request

3. **Workflow**:
   ```
   key-validator.ts runs
   ↓ Reorganizes .env
   ↓
   Server starts/reloads
   ↓ ProviderKeyManager loads valid keys
   ↓
   Health checks validate every 5 min
   ↓
   Expired keys auto-marked degraded
   ↓
   Next key-validator run replaces them
   ```

## Adding Custom Providers

Extend `PROVIDERS_CONFIG` to add new providers:

```typescript
const PROVIDERS_CONFIG: Record<string, ProviderConfig> = {
  my_provider: {
    name: "My API",
    testEndpoint: "https://api.myprovider.com/test",
    headers: (key) => ({
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    }),
    body: () => JSON.stringify({ test: true }),
    timeout: 10000,
    statusCodes: {
      success: [200],
      invalid: [401, 403],
      rateLimited: [429],
    },
  },
};
```

## Maintenance Tasks

### Weekly
- Run validator
- Review report for issues
- Note any rate-limited keys

### Monthly
- Clean old logs: `rm .key-validation-logs/validation-*.json` (keep reports)
- Review error patterns
- Check provider API status pages

### Quarterly
- Audit all keys for security
- Rotate potentially compromised keys
- Update provider configurations if needed

## Performance Optimization

**Latency metrics available in reports:**
- Fastest key (best for time-sensitive operations)
- Slowest key (candidates for removal)
- Average latency (baseline)

**Use for:**
- Prioritize faster keys in routing
- Identify problematic keys
- Track provider performance changes

## Troubleshooting

**Validator hangs?**
- One key is timing out (>15s)
- Provider may be having issues
- Try again in 30 minutes
- Or: Comment out slow keys, run again

**All keys marked invalid?**
- Possible network issue
- Check internet connectivity
- Check if providers are down (status pages)
- Verify .env file format is correct

**High latency for Gemini keys?**
- Gemini API is slower than OpenRouter
- Normal: 800-1500ms per key
- If >3000ms consistently: consider reducing Gemini usage

**"rate_limited" status?**
- Provider is rate limiting
- Wait 30 minutes before next validation
- Don't retry aggressively

## Testing the Validator

```bash
# Dry-run: validate one key manually
curl -X POST https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"nvidia/nemotron-3-nano-30b-a3b:free","messages":[{"role":"user","content":"test"}],"max_tokens":1}' \
  -w "\nStatus: %{http_code}\nLatency: %{time_total}s\n"

# Then run full validator to compare
npx ts-node key-validator.ts
```

## Future Enhancements

- Validate keys from multiple regions simultaneously
- Track key rotation history with previous versions
- Alert on deprecated provider endpoints
- Auto-fetch free keys from provider SDKs
- Export metrics to Prometheus/Grafana
- Web dashboard for key inventory
- Slack notifications for invalid keys
