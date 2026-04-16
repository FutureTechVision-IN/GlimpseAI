#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() {
  printf '[stop] %s\n' "$*"
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif has_cmd docker-compose; then
    docker-compose "$@"
  else
    return 1
  fi
}

stop_port() {
  local port="$1"
  local pids=""

  if ! has_cmd lsof; then
    return
  fi

  pids="$(lsof -ti "tcp:${port}" -sTCP:LISTEN || true)"
  if [ -z "${pids}" ]; then
    return
  fi

  log "Stopping process(es) on port ${port}: ${pids//$'\n'/, }"
  while IFS= read -r pid; do
    [ -n "${pid}" ] || continue
    kill "${pid}" 2>/dev/null || true
  done <<< "${pids}"
}

stop_local_processes() {
  stop_port 3001

  local port
  for port in 5173 5174 5175 5176 5177 5178 5179 5180; do
    stop_port "${port}"
  done
}

stop_docker_services() {
  if ! has_cmd docker; then
    return
  fi

  if ! docker info >/dev/null 2>&1; then
    return
  fi

  if ! docker_compose -f "${ROOT_DIR}/docker-compose.yml" ps >/dev/null 2>&1; then
    return
  fi

  local running_services
  running_services="$(docker_compose -f "${ROOT_DIR}/docker-compose.yml" ps --services --status running 2>/dev/null || true)"

  if [ -z "${running_services}" ]; then
    return
  fi

  log "Stopping Docker services"
  docker_compose -f "${ROOT_DIR}/docker-compose.yml" stop >/dev/null
}

main() {
  stop_local_processes
  stop_docker_services
  log "Done"
}

main "$@"
