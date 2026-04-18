#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE=""
BUILD=0

WEB_PORT="${WEB_PORT:-5173}"
API_PORT="${API_PORT:-3001}"
DB_PORT="${DB_PORT:-5432}"
BASE_PATH="${BASE_PATH:-/}"
POSTGRES_DB="${POSTGRES_DB:-glimpseai}"
POSTGRES_USER="${POSTGRES_USER:-glimpseai}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-glimpseai}"
SESSION_SECRET="${SESSION_SECRET:-glimpse-ai-local-dev-secret}"
RAZORPAY_KEY_ID="${RAZORPAY_KEY_ID:-rzp_test_placeholder}"
RAZORPAY_KEY_SECRET="${RAZORPAY_KEY_SECRET:-placeholder_secret}"

usage() {
  cat <<EOF
Usage:
  ./start.sh                    Auto-detect and start
  ./start.sh --docker           Full Docker mode
  ./start.sh --native           No Docker, native Node.js
  ./start.sh --hybrid           Docker DB + native dashboard/API
  ./start.sh --docker --build   Rebuild and start Docker

Environment overrides:
  WEB_PORT, API_PORT, DB_PORT
  BASE_PATH
  DATABASE_URL
  POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD
  SESSION_SECRET, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
EOF
}

log() {
  printf '[start] %s\n' "$*"
}

die() {
  printf '[start] ERROR: %s\n' "$*" >&2
  exit 1
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

port_in_use() {
  local port="$1"
  if has_cmd lsof; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi

  (echo >"/dev/tcp/127.0.0.1/${port}") >/dev/null 2>&1
}

docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif has_cmd docker-compose; then
    docker-compose "$@"
  else
    die "Docker Compose is required for this mode."
  fi
}

ensure_pnpm() {
  if has_cmd pnpm; then
    return
  fi

  if has_cmd corepack; then
    log "Enabling pnpm via corepack"
    corepack enable >/dev/null 2>&1 || true
  fi

  has_cmd pnpm || die "pnpm is required but was not found."
}

ensure_native_deps() {
  ensure_pnpm

  if [ ! -d "${ROOT_DIR}/node_modules" ]; then
    log "Installing workspace dependencies with pnpm"
    (
      cd "${ROOT_DIR}"
      pnpm install --frozen-lockfile
    )
  fi
}

require_docker() {
  has_cmd docker || die "Docker is required for this mode."
  docker info >/dev/null 2>&1 || die "Docker is installed but not running."
}

wait_for_db() {
  local attempts=60
  log "Waiting for PostgreSQL on port ${DB_PORT}"

  for ((i = 1; i <= attempts; i++)); do
    if (echo >"/dev/tcp/127.0.0.1/${DB_PORT}") >/dev/null 2>&1; then
      log "PostgreSQL is ready"
      return
    fi
    sleep 2
  done

  die "PostgreSQL did not become ready on port ${DB_PORT}."
}

select_hybrid_db_port() {
  if [ -n "${DB_PORT:-}" ] && [ "${DB_PORT}" != "5432" ]; then
    return
  fi

  if port_in_use 5432; then
    DB_PORT=5433
    export DB_PORT
    log "Port 5432 is already in use locally; using Docker PostgreSQL port ${DB_PORT} instead"
  fi
}

run_db_push() {
  log "Applying database schema"
  (
    cd "${ROOT_DIR}/lib/db"
    DATABASE_URL="${DATABASE_URL}" ./node_modules/.bin/drizzle-kit push --config ./drizzle.config.ts
  )
}

run_native_stack() {
  local wait_for_local_db="${1:-0}"
  export BASE_PATH API_PORT WEB_PORT SESSION_SECRET RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET DATABASE_URL
  export API_PROXY_TARGET="http://127.0.0.1:${API_PORT}"

  if [ "${wait_for_local_db}" = "1" ]; then
    wait_for_db
  fi
  run_db_push

  log "Starting API on http://127.0.0.1:${API_PORT}"
  (
    cd "${ROOT_DIR}/artifacts/api-server"
    export PORT="${API_PORT}"
    export DATABASE_URL="${DATABASE_URL}"
    export SESSION_SECRET="${SESSION_SECRET}"
    export RAZORPAY_KEY_ID="${RAZORPAY_KEY_ID}"
    export RAZORPAY_KEY_SECRET="${RAZORPAY_KEY_SECRET}"
    node ./build.mjs
    node --enable-source-maps ./dist/index.mjs
  ) &
  local api_pid=$!

  log "Starting dashboard on http://127.0.0.1:${WEB_PORT}"
  (
    cd "${ROOT_DIR}/artifacts/glimpse-ai"
    export PORT="${WEB_PORT}"
    export BASE_PATH="${BASE_PATH}"
    export API_PROXY_TARGET="${API_PROXY_TARGET}"
    ./node_modules/.bin/vite --config vite.config.ts --host 0.0.0.0
  ) &
  local web_pid=$!

  trap 'kill "${api_pid}" "${web_pid}" 2>/dev/null || true' INT TERM EXIT
  wait "${api_pid}" "${web_pid}"
}

start_hybrid() {
  require_docker
  ensure_native_deps
  select_hybrid_db_port

  export DATABASE_URL="${DATABASE_URL:-postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${DB_PORT}/${POSTGRES_DB}}"

  log "Starting PostgreSQL container"
  (
    cd "${ROOT_DIR}"
    docker_compose up -d db
  )

  run_native_stack 1
}

start_native() {
  ensure_native_deps

  if [ -z "${DATABASE_URL:-}" ]; then
    die "Native mode requires DATABASE_URL to be set. Use --hybrid to start a local Docker PostgreSQL."
  fi

  run_native_stack 0
}

start_docker() {
  require_docker

  local args=(up)
  if [ "${BUILD}" -eq 1 ]; then
    args+=(--build)
  fi

  log "Starting Docker services"
  (
    cd "${ROOT_DIR}"
    docker_compose "${args[@]}"
  )
}

auto_detect_mode() {
  if [ -n "${MODE}" ]; then
    return
  fi

  if [ -n "${DATABASE_URL:-}" ]; then
    MODE="native"
    return
  fi

  if has_cmd docker && docker info >/dev/null 2>&1; then
    MODE="hybrid"
    return
  fi

  MODE="native"
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --docker)
        MODE="docker"
        ;;
      --native)
        MODE="native"
        ;;
      --hybrid)
        MODE="hybrid"
        ;;
      --build)
        BUILD=1
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        usage
        die "Unknown argument: $1"
        ;;
    esac
    shift
  done
}

main() {
  parse_args "$@"
  auto_detect_mode

  case "${MODE}" in
    docker)
      start_docker
      ;;
    native)
      start_native
      ;;
    hybrid)
      start_hybrid
      ;;
    *)
      die "Unsupported mode: ${MODE}"
      ;;
  esac
}

main "$@"
