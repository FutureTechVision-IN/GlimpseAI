# RunPod Restoration Sidecar Deployment

This sidecar restores production Auto Face quality by serving the existing GFPGAN / CodeFormer / Real-ESRGAN restoration API from a GPU-backed RunPod load-balanced endpoint. The Render API should call this service over direct HTTP using `RESTORATION_SERVICE_URL`; do not use RunPod queue or `/runsync` routes for this integration.

## Build And Push

Build from the repository root so the Dockerfile can copy `services/restoration/server.py`, dependencies, and bundled model weights.

```bash
docker build \
  -f services/restoration/Dockerfile.runpod \
  -t <registry>/glimpse-restoration:latest \
  .

docker push <registry>/glimpse-restoration:latest
```

Use a registry that RunPod can pull from. If the registry is private, configure the matching registry credentials in RunPod.

## RunPod Endpoint

Create a load-balanced Serverless endpoint with:

- Container image: `<registry>/glimpse-restoration:latest`
- HTTP port: `7860`
- Health check path: `/ping`
- Environment: `PORT=7860`
- GPU enabled

Expected direct HTTP checks:

```bash
curl https://<endpoint-id>.api.runpod.ai/ping
curl https://<endpoint-id>.api.runpod.ai/health
```

`/ping` should return `{"status":"ok"}`. `/health` should include `capabilities` such as `auto_face` / `face_restore` and model availability.

## Render API Environment

Set these on the Render backend service. Keep values secret and do not commit them.

```text
RESTORATION_SERVICE_URL=https://<endpoint-id>.api.runpod.ai
RESTORATION_SERVICE_TOKEN=<optional bearer token if the endpoint requires auth>
```

`RESTORATION_SERVICE_URL` must be the endpoint base URL only. The API app appends `/health`, `/restore`, and `/restore-video`.

## Production Verification

After redeploying Render:

```bash
curl https://glimpse-ai-api-docker.onrender.com/api/healthz
```

Then run Auto Face in Photo Studio. Render logs should include `Calling restoration service` and `Restoration complete`; they should not include the fallback warning `Restoration service unreachable`.

