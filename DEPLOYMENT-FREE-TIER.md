# GlimpseAI Free-Tier Deployment

This deployment path keeps the hosted frontend on Vercel, runs the Express API on a Render Free Web Service, and points the API at an existing externally reachable Postgres database.

## Chosen Free Stack

- Frontend: Vercel static hosting.
- Backend API: Render Free Web Service using `artifacts/api-server/Dockerfile.production`.
- Database: Existing Postgres database using its connection string as `DATABASE_URL`.
- Media storage: Google Drive folder `17-NtAES7W6ua0FS7mqYX3-thbRkQkLQG` with a service account, or fallback data URI storage for testing only.

Render Free web services can spin down when idle, so first login or first enhancement after inactivity may take about a minute to wake up. The existing database must allow inbound connections from Render. If the database has an IP allowlist, permit Render outbound traffic or temporarily allow public SSL connections while testing.

## 1. Prepare Existing Database

1. Confirm the database is PostgreSQL.
2. Confirm it is reachable from the public internet or from Render.
3. Confirm the user in the connection string can create/update tables during deployment.
4. Copy the connection string. It will be used as `DATABASE_URL` in Render.
5. Keep it private. Do not commit it to this repository.

## 2. Deploy Backend On Render Free

1. Connect the GitHub repository to Render.
2. Create a Blueprint from `render.yaml`.
3. Choose the `glimpse-ai-api` service.
4. Fill these required secret values in Render:

```text
DATABASE_URL=<existing Postgres connection string>
ADMIN_EMAIL=<admin login email>
ADMIN_PASSWORD=<strong admin password>
GOOGLE_SERVICE_ACCOUNT_EMAIL=<Google service account email>
GOOGLE_PRIVATE_KEY=<Google service account private key with escaped newlines or multiline secret support>
```

Optional production values:

```text
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
PROVIDER_KEYS_NVIDIA_NEMOTRON_3_NANO_30B_A3B_FREE=
PROVIDER_KEYS_NVIDIA_NEMOTRON_3_SUPER_120B_A12B_FREE=
PROVIDER_KEYS_STEPFUN_STEP_3_5_FLASH_FREE=
PROVIDER_KEYS_ZAI_GLM_4_5_AIR_FREE=
```

Render will build the Docker image and start the API on port `10000`. Because Render Free services do not support pre-deploy commands, the production container runs `pnpm --filter @workspace/db push` during startup before launching the API.

## 3. Verify Backend

After Render finishes deployment, open:

```text
https://<your-render-service>.onrender.com/api/healthz
```

Expected response:

```json
{"status":"ok"}
```

## 4. Point Vercel Frontend At Backend

Replace the URL below with the Render API origin:

```bash
printf 'https://<your-render-service>.onrender.com\n' | vercel env add VITE_API_URL production
vercel --prod
```

If `VITE_API_URL` already exists, remove it first:

```bash
vercel env rm VITE_API_URL production --yes
printf 'https://<your-render-service>.onrender.com\n' | vercel env add VITE_API_URL production
vercel --prod
```

## 5. End-To-End Smoke Test

1. Visit `https://glimpse-ai-five.vercel.app`.
2. Register or log in.
3. Upload a small image in Photo Studio.
4. Run an enhancement.
5. Confirm the enhanced result appears and downloads.
6. Confirm processed media URLs are Drive URLs when Google Drive credentials are configured.

## Known Free-Tier Limits

- Render Free services spin down after idle time and have cold starts.
- Render Free has monthly instance-hour and bandwidth limits.
- The existing database must remain reachable from Render and should enforce SSL if exposed publicly.
- Google Drive direct links are fine for demos, but Google Cloud Storage, Cloudflare R2, or S3-compatible storage is better for production-grade media delivery.
