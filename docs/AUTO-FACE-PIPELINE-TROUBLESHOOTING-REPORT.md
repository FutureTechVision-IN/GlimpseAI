# Auto Face Pipeline Troubleshooting Report

Last updated: 2026-05-05

## Executive Summary

The Auto Face implementation is wired correctly through the frontend, API orchestration, restoration client, and local sidecar path. The production user experience still shows `Native fallback` because production does not yet have a live GPU restoration endpoint URL configured in Render.

The current hard blocker is external infrastructure, not application code:

- GHCR image access is fixed and anonymous pulls work for `ghcr.io/futuretechvision-in/glimpse-restoration:0.1.2`.
- RunPod serverless template creation succeeded with template id `oki2rd6r0y`.
- RunPod endpoint creation failed because the account balance is below RunPod's minimum endpoint-creation threshold.
- Render should not receive `RESTORATION_SERVICE_URL` until the RunPod endpoint exists and `/ping` plus `/health` pass.

## Current Known-Good Artifacts

- Source branch: `main`
- Latest relevant commits:
  - `47185f6 chore(restoration): label RunPod image source`
  - `04eaed9 fix(restoration): bundle sidecar model weights`
  - `4391752 fix(api): route auto face through restoration service`
- Restoration image: `ghcr.io/futuretechvision-in/glimpse-restoration:0.1.2`
- Image digest: `sha256:2038e900a667a4698fc2c9d445c59a05db3adfccb935064f5b6ba756b62ab8ef`
- RunPod template id: `oki2rd6r0y`
- Production API health: `https://glimpse-ai-api-docker.onrender.com/api/healthz`

## End-To-End Pipeline Assessment

The intended image path is:

1. Frontend upload creates or updates a media job.
2. Photo Studio sends Auto Face requests through `/api/media/enhance-chain` when filters or chained actions are involved.
3. `/api/media/enhance-chain` builds a chain spec with `enhance: "auto_face"` and optional `filterId` / `upscale`.
4. `runEnhancementChain()` applies enhancement, then filter, then upscale in that order.
5. `enhanceImage()` detects restoration-class operations and probes the restoration service through `restoration-client.ts`.
6. If `/health` is reachable and advertises restoration capabilities, the API calls `/restore`.
7. If the sidecar is not reachable, the API logs fallback and uses the Sharp-native fallback path.
8. The UI reads chain metadata and AI recommendation metadata to show `sidecar` or `Native fallback`.

This means the screenshot showing `Native fallback` is expected whenever Render lacks a valid `RESTORATION_SERVICE_URL` or the configured service fails health probing.

## Component Verification

| Component | Status | Notes |
| --- | --- | --- |
| Frontend request path | Passing | Auto Face routes through `auto_face`; chained filter flow uses `/api/media/enhance-chain`. |
| Backend chain orchestration | Passing | `runEnhancementChain()` preserves enhance -> filter -> upscale ordering and marks sidecar usage. |
| Restoration client | Passing | Centralizes `RESTORATION_SERVICE_URL`, optional bearer token, redacted logging, timeout, retry, and health caching. |
| AI recommendation badge | Passing | `ai-provider.ts` uses the shared restoration health probe, so the admin badge agrees with backend availability. |
| RunPod Docker image | Passing | Dockerfile copies API server, GFPGAN/RealESRGAN model weights, GFPGAN auxiliary weights, and CodeFormer module/weights. |
| GHCR registry access | Passing | `0.1.2` is public and anonymously pullable. |
| RunPod template | Passing | Template `oki2rd6r0y` exists for `glimpse-restoration-0.1.2`. |
| RunPod endpoint | Blocked | Endpoint creation returns a RunPod account-balance error. |
| Render env | Pending | Do not set `RESTORATION_SERVICE_URL` until the endpoint URL exists. |
| Production Auto Face quality | Pending | Production is still expected to use native fallback until Render points to a live sidecar. |

## Root Cause Analysis

### P0: RunPod Endpoint Not Created

RunPod rejected endpoint creation with:

```text
You must have at least $0.01 in your account balance to create an endpoint.
```

Impact:

- No `https://<endpoint-id>.api.runpod.ai` base URL exists.
- Render cannot be safely configured with `RESTORATION_SERVICE_URL`.
- Production Auto Face continues to use Sharp-native fallback.

Fix:

- Add the minimum required RunPod credit/balance.
- Re-run endpoint creation using template `oki2rd6r0y`.
- Verify `/ping` and `/health`.
- Set Render `RESTORATION_SERVICE_URL` to the verified endpoint base URL.

Estimated effort: 10-20 minutes after RunPod billing is unblocked.

Priority: P0.

### P1: Secret Hygiene

The RunPod API key was visible during setup.

Impact:

- The key should be treated as exposed.

Fix:

- Rotate the RunPod API key after endpoint creation.
- Store any required long-lived tokens only in provider dashboards, not in code or chat.

Estimated effort: 5 minutes.

Priority: P1.

### P2: Production Validation Requires Live Sidecar

Local tests can prove the restoration integration works, but they cannot prove CUDA production routing until RunPod is live.

Impact:

- Current production verification can only confirm healthy API and native fallback behavior.

Fix:

- After endpoint creation, run the production smoke test and confirm Render logs include `Calling restoration service` and `Restoration complete` with a GPU device.

Estimated effort: 15-30 minutes after endpoint is live.

Priority: P2.

## Fixes Already Applied

- Added shared restoration client for backend health probing, auth headers, redacted logging, and retry-safe fetches.
- Updated image enhancement and AI recommendation flows to use the shared client.
- Added `RESTORATION_SERVICE_URL` and `RESTORATION_SERVICE_TOKEN` as non-synced Render env vars.
- Added RunPod Dockerfile with CUDA PyTorch runtime.
- Added `/ping` and `PORT` support for RunPod load-balanced health checks.
- Bundled model weights into the RunPod image.
- Added OCI source/description labels to help GHCR package metadata.
- Published public GHCR image `0.1.2`.
- Created RunPod serverless template `oki2rd6r0y`.

## Validation Performed

Local validation from the source-of-truth checkout:

```bash
pnpm --filter @workspace/api-server typecheck
python3 -m py_compile services/restoration/server.py
pnpm --filter @workspace/api-server test -- --run artifacts/api-server/src/lib/enhancement-chain-matrix.test.ts artifacts/api-server/src/lib/media-pipeline-matrix.test.ts
```

Observed result:

- API typecheck passed.
- Python sidecar compilation passed.
- Vitest completed `106/106` passing tests.
- Local sidecar logs showed `Restoration complete` with `device: "mps"`.
- Fallback paths also behaved correctly when health probes failed.

Production validation:

```bash
curl https://glimpse-ai-api-docker.onrender.com/api/healthz
```

Observed result:

```json
{"status":"ok"}
```

## Final Working Configuration Target

RunPod endpoint:

- Template id: `oki2rd6r0y`
- Image: `ghcr.io/futuretechvision-in/glimpse-restoration:0.1.2`
- HTTP port: `7860`
- Health path: `/ping`
- Env: `PORT=7860`, `RESTORATION_PORT=7860`
- GPU: RTX 4090 preferred, A40 fallback
- Workers: `workersMin=0`, `workersMax=1` for low-cost validation

Render backend:

```text
RESTORATION_SERVICE_URL=https://<endpoint-id>.api.runpod.ai
RESTORATION_SERVICE_TOKEN=<only if endpoint auth is enabled>
```

Expected success signals:

- `GET /ping` returns `{"status":"ok"}`.
- `GET /health` returns `status: "ok"` and capabilities including `auto_face`.
- Render logs show `Calling restoration service`.
- Render logs show `Restoration complete` with GPU device metadata.
- Photo Studio admin badge no longer shows `Native fallback`.

## Continuous Retry Protocol

For each failed attempt:

1. Capture the exact failing command or UI step.
2. Classify the failure as registry access, endpoint creation, endpoint health, Render env, API health, or enhancement quality.
3. Check the nearest health boundary before moving downstream:
   - GHCR anonymous manifest pull.
   - RunPod endpoint `/ping`.
   - RunPod endpoint `/health`.
   - Render `/api/healthz`.
   - Photo Studio `/api/media/enhance-chain`.
4. Apply one fix only.
5. Re-run the boundary check.
6. Do not update downstream configuration until the upstream boundary is green.

## Prevention Recommendations

- Add a deployment checklist that blocks Render `RESTORATION_SERVICE_URL` changes until `/ping` and `/health` pass.
- Keep a small positive RunPod balance or documented billing check before GPU endpoint creation.
- Rotate API keys after any assisted browser or chat-driven setup.
- Add a CI job that verifies the GHCR image tag exists and is anonymously pullable before release.
- Add a production-only health endpoint or admin diagnostic that reports restoration availability without exposing secrets.
