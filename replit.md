# GlimpseAI Workspace

## Overview

GlimpseAI is a production-ready AI-powered media editing platform for photos and videos. Built as a full-stack pnpm monorepo with React + Vite frontend and Express API backend.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + Tailwind CSS + Framer Motion
- **Auth**: JWT-based (bcryptjs + jsonwebtoken)
- **Payments**: Razorpay integration

## Product Features

- Landing page with before/after showcase
- User authentication (register/login/forgot password)
- Photo and video editing flows with AI enhancement types
- 12 presets: Auto Enhance, Portrait Retouch, Cinematic Color, Beauty Filter, etc.
- Freemium model: 5 free uses, Pro (50/month), Studio (200/month) plans
- Pricing page with monthly/annual toggle
- User dashboard with usage stats
- Media history/gallery
- Razorpay payment integration
- Full SaaS Admin Console at `/admin` (sidebar nav, 6 sections):
  - **Overview**: live stats cards, 30-day activity area chart, free/paid pie chart, media breakdown bar chart, conversion funnel, recent signups/payments
  - **Users**: searchable paginated table, suspend/restore, credit limit adjustment per user
  - **Jobs**: all processing jobs with status filter (all/pending/processing/completed/failed), failed jobs highlighted in red
  - **Payments**: transaction history with revenue stats and success rate
  - **Plans**: view/create/edit subscription plans with feature lists and pricing
  - **AI Providers**: add/enable/disable providers, rotate API keys, view error counts
- Admin account: `admin@glimpse.ai` (password set by owner)
- Custom `/api/admin/usage` endpoint for 30-day daily breakdowns
- Custom `/api/admin/funnel` endpoint for conversion funnel metrics

## Architecture

- **Frontend**: `artifacts/glimpse-ai/` (React Vite, dark cinematic theme)
- **API**: `artifacts/api-server/` (Express 5, JWT auth, all routes)
- **Database**: `lib/db/` (Drizzle ORM schemas)
- **API Spec**: `lib/api-spec/openapi.yaml` (OpenAPI 3.1)
- **Generated hooks**: `lib/api-client-react/` (React Query hooks)
- **Generated Zod schemas**: `lib/api-zod/` (server-side validation)

## Database Tables

- `users` — user accounts, auth, plan, credits
- `plans` — subscription plans (Free/Pro/Studio)
- `media_jobs` — photo/video processing jobs
- `presets` — enhancement presets
- `payments` — payment records
- `providers` — AI provider keys and config

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Environment Variables Required

- `DATABASE_URL` — PostgreSQL connection string (auto-provisioned)
- `SESSION_SECRET` — JWT signing secret
- `RAZORPAY_KEY_ID` — Razorpay API key (optional for dev)
- `RAZORPAY_KEY_SECRET` — Razorpay secret (optional for dev)

## Default Seed Data

- 3 plans: Free (0₹), Pro (₹499/mo), Studio (₹1,299/mo)
- 12 enhancement presets (photo, video, both)
