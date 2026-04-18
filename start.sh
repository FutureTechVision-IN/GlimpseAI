#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE=""
BUILD=0

# ---------------------------------------------------------------------------
# Source .env (if present) so all vars are available before defaults kick in
# ---------------------------------------------------------------------------
load_env() {
  local env_file="${ROOT_DIR}/.env"
  if [ ! -f "${env_file}" ]; then
    return
  fi

  while IFS= read -r line || [ -n "${line}" ]; do
    # Skip comments and blank lines
    [[ "${line}" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// /}" ]] && continue
    local key val
    key="${line%%=*}"
    val="${line#*=}"
    # Remove surrounding single/double quotes from value
    val="${val#\'}" ; val="${val%\'}"
    val="${val#\"}" ; val="${val%\"}"
    export "${key}=${val}"
  done < "${env_file}"
}

load_env

# ---------------------------------------------------------------------------
# Defaults — only apply when the variable was NOT already set (incl. from .env)
# ---------------------------------------------------------------------------
WEB_PORT="${WEB_PORT:-5173}"
API_PORT="${API_PORT:-3001}"
DB_PORT="${DB_PORT:-5432}"
BASE_PATH="${BASE_PATH:-/}"
POSTGRES_DB="${POSTGRES_DB:-glimpseai}"
POSTGRES_USER="${POSTGRES_USER:-bipbabu}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"
SESSION_SECRET="${SESSION_SECRET:-glimpse-ai-local-dev-secret}"
RAZORPAY_KEY_ID="${RAZORPAY_KEY_ID:-rzp_test_placeholder}"
RAZORPAY_KEY_SECRET="${RAZORPAY_KEY_SECRET:-placeholder_secret}"

usage() {
  cat <<EOF
Usage:
  ./start.sh                    Auto-detect and start
  ./start.sh --docker           Full Docker mode
  ./start.sh --native           No Docker, native Node.js (uses local postgres)
  ./start.sh --hybrid           Docker DB + native dashboard/API
  ./start.sh --docker --build   Rebuild and start Docker

Environment overrides (or set in .env):
  WEB_PORT, API_PORT, DB_PORT, BASE_PATH
  DATABASE_URL
  POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD
  SESSION_SECRET, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
EOF
}

log() {
  printf '\033[1;36m[start]\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33m[start] WARN:\033[0m %s\n' "$*"
}

die() {
  printf '\033[1;31m[start] ERROR:\033[0m %s\n' "$*" >&2
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

# Find the first free port starting from $1, trying up to 10 ports
find_free_port() {
  local base_port="$1"
  for offset in 0 1 2 3 4 5 6 7 8 9; do
    local candidate=$((base_port + offset))
    if ! port_in_use "${candidate}"; then
      echo "${candidate}"
      return
    fi
  done
  die "No free port found in range ${base_port}–$((base_port + 9))"
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

# Stop any existing GlimpseAI containers to avoid port conflicts
cleanup_containers() {
  if ! has_cmd docker || ! docker info >/dev/null 2>&1; then
    return
  fi

  local running
  running="$(docker ps -q --filter "name=glimpseai" 2>/dev/null || true)"
  if [ -n "${running}" ]; then
    log "Stopping existing GlimpseAI containers"
    # shellcheck disable=SC2086
    docker stop ${running} >/dev/null 2>&1 || true
    docker rm ${running} >/dev/null 2>&1 || true
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
    (cd "${ROOT_DIR}" && pnpm install --frozen-lockfile)
  fi
}

require_docker() {
  has_cmd docker || die "Docker is required for this mode."
  docker info >/dev/null 2>&1 || die "Docker is installed but not running."
}

wait_for_db() {
  local port="${1:-${DB_PORT}}"
  local attempts=30
  log "Waiting for PostgreSQL on port ${port}"

  for ((i = 1; i <= attempts; i++)); do
    if has_cmd pg_isready; then
      if pg_isready -h 127.0.0.1 -p "${port}" -q 2>/dev/null; then
        log "PostgreSQL is ready on port ${port}"
        return
      fi
    elif (echo >"/dev/tcp/127.0.0.1/${port}") >/dev/null 2>&1; then
      log "PostgreSQL is ready on port ${port}"
      return
    fi
    sleep 2
  done

  die "PostgreSQL did not become ready on port ${port} after ${attempts} attempts."
}

# Ensure the glimpseai database exists on the target postgres instance
ensure_database() {
  local db_url="${1}"
  # Extract host, port, user from the DATABASE_URL
  if has_cmd psql; then
    local db_name="${POSTGRES_DB}"
    local db_user="${POSTGRES_USER}"
    local db_port="${DB_PORT}"
    local exists
    exists="$(psql -U "${db_user}" -h 127.0.0.1 -p "${db_port}" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${db_name}'" 2>/dev/null || true)"
    if [ "${exists}" != "1" ]; then
      log "Creating database '${db_name}'"
      psql -U "${db_user}" -h 127.0.0.1 -p "${db_port}" -d postgres -c "CREATE DATABASE ${db_name}" 2>/dev/null \
        || warn "Could not create database '${db_name}' — it may already exist or need manual creation"
    else
      log "Database '${db_name}' already exists"
    fi
  fi
}

run_db_push() {
  log "Applying database schema (drizzle-kit push)"
  (
    cd "${ROOT_DIR}/lib/db"
    DATABASE_URL="${DATABASE_URL}" npx drizzle-kit push --config ./drizzle.config.ts
  )
}

run_native_stack() {
  local wait_for_local_db="${1:-0}"
  export BASE_PATH API_PORT WEB_PORT SESSION_SECRET RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET DATABASE_URL
  export API_PROXY_TARGET="http://127.0.0.1:${API_PORT}"

  # Check for port conflicts early
  if port_in_use "${API_PORT}"; then
    local new_api_port
    new_api_port="$(find_free_port "${API_PORT}")"
    warn "Port ${API_PORT} in use, switching API to port ${new_api_port}"
    API_PORT="${new_api_port}"
    export API_PORT
    export API_PROXY_TARGET="http://127.0.0.1:${API_PORT}"
  fi

  if port_in_use "${WEB_PORT}"; then
    local new_web_port
    new_web_port="$(find_free_port "${WEB_PORT}")"
    warn "Port ${WEB_PORT} in use, switching web to port ${new_web_port}"
    WEB_PORT="${new_web_port}"
    export WEB_PORT
  fi

  if [ "${wait_for_local_db}" = "1" ]; then
    wait_for_db "${DB_PORT}"
  fi

  ensure_database "${DATABASE_URL}"
  run_db_push

  log "Starting API on http://127.0.0.1:${API_PORT}"
  (
    cd "${ROOT_DIR}/artifacts/api-server"
    export PORT="${API_PORT}"
    node ./build.mjs
    node --enable-source-maps ./dist/index.mjs
  ) &
  local api_pid=$!

  log "Starting dashboard on http://127.0.0.1:${WEB_PORT}"
  (
    cd "${ROOT_DIR}/artifacts/glimpse-ai"
    export PORT="${WEB_PORT}"
    npx vite --config vite.config.ts --host 0.0.0.0
  ) &
  local web_pid=$!

  log ""
  log "=============================="
  log "  GlimpseAI is starting up"
  log "  Dashboard: http://localhost:${WEB_PORT}"
  log "  API:       http://localhost:${API_PORT}"
  log "  Mode:      ${MODE}"
  log "=============================="
  log ""

  trap 'log "Shutting down..."; kill "${api_pid}" "${web_pid}" 2>/dev/null || true' INT TERM EXIT
  wait "${api_pid}" "${web_pid}"
}

start_hybrid() {
  require_docker
  ensure_native_deps
  cleanup_containers

  # Find a free port for the Docker postgres
  if port_in_use "${DB_PORT}"; then
    DB_PORT="$(find_free_port 5432)"
    export DB_PORT
    log "Using Docker PostgreSQL on port ${DB_PORT}"
  fi

  export DATABASE_URL="${DATABASE_URL:-postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${DB_PORT}/${POSTGRES_DB}}"

  log "Starting PostgreSQL container on port ${DB_PORT}"
  (cd "${ROOT_DIR}" && docker_compose up -d db)

  run_native_stack 1
}

start_native() {
  ensure_native_deps

  # Build DATABASE_URL from parts if not explicitly set
  if [ -z "${DATABASE_URL:-}" ]; then
    # Check if local postgres is running
    if port_in_use 5432; then
      DB_PORT=5432
      if [ -n "${POSTGRES_PASSWORD}" ]; then
        DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${DB_PORT}/${POSTGRES_DB}"
      else
        DATABASE_URL="postgresql://${POSTGRES_USER}@localhost:${DB_PORT}/${POSTGRES_DB}"
      fi
      export DATABASE_URL
      log "Using local PostgreSQL: ${DATABASE_URL}"
    else
      die "Native mode requires a running PostgreSQL. Either:\n  - Start local postgres, or\n  - Set DATABASE_URL in .env, or\n  - Use --hybrid for a Docker PostgreSQL."
    fi
  fi

  run_native_stack 0
}

start_docker() {
  require_docker
  cleanup_containers

  local args=(up)
  if [ "${BUILD}" -eq 1 ]; then
    args+=(--build)
  fi

  log "Starting Docker services"
  (cd "${ROOT_DIR}" && docker_compose "${args[@]}")
}

auto_detect_mode() {
  if [ -n "${MODE}" ]; then
    return
  fi

  # If DATABASE_URL is set and points to a reachable host, go native
  if [ -n "${DATABASE_URL:-}" ]; then
    MODE="native"
    log "Auto-detected mode: native (DATABASE_URL is set)"
    return
  fi

  # If local postgres is running, go native
  if port_in_use 5432; then
    MODE="native"
    log "Auto-detected mode: native (local PostgreSQL on 5432)"
    return
  fi

  # If Docker is available, use hybrid
  if has_cmd docker && docker info >/dev/null 2>&1; then
    MODE="hybrid"
    log "Auto-detected mode: hybrid (Docker available, no local PostgreSQL)"
    return
  fi

  die "Cannot auto-detect mode. No PostgreSQL running and Docker is unavailable.\n  Use --native with DATABASE_URL or --hybrid with Docker."
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
