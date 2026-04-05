#!/bin/zsh

set -euo pipefail

WORKSPACE_ROOT="${1:-$HOME/.openclaw/workspace}"
CONFIG_PATH="${2:-$HOME/.openclaw/openclaw.json}"

required_workspace_files=(
  "AGENTS.md"
  "BOOTSTRAP.md"
  "SOUL.md"
  "IDENTITY.md"
  "USER.md"
  "TOOLS.md"
  "ARCOS_RUNTIME.md"
  "HOOKS.md"
)

required_hook_names=(
  "session-memory"
  "command-logger"
  "bootstrap-extra-files"
  "boot-md"
)

missing_files=()
present_files=()
for rel in "${required_workspace_files[@]}"; do
  abs="$WORKSPACE_ROOT/$rel"
  if [[ -f "$abs" ]]; then
    present_files+=("$rel")
  else
    missing_files+=("$rel")
  fi
done

missing_hooks=()
if [[ -f "$CONFIG_PATH" ]]; then
  for hook_name in "${required_hook_names[@]}"; do
    if ! grep -Fq "\"$hook_name\"" "$CONFIG_PATH"; then
      missing_hooks+=("$hook_name")
    fi
  done
else
  missing_hooks=("openclaw.json missing")
fi

boot_status="ok"
if (( ${#missing_files[@]} > 0 || ${#missing_hooks[@]} > 0 )); then
  boot_status="degraded"
fi

print "{"
print "  \"status\": \"$boot_status\","
print "  \"workspace\": \"$WORKSPACE_ROOT\","
print "  \"config\": \"$CONFIG_PATH\","
print "  \"presentFiles\": ["
for (( i = 1; i <= ${#present_files[@]}; i++ )); do
  sep=","
  if (( i == ${#present_files[@]} )); then
    sep=""
  fi
  print "    \"${present_files[$i]}\"$sep"
done
print "  ],"
print "  \"missingFiles\": ["
for (( i = 1; i <= ${#missing_files[@]}; i++ )); do
  sep=","
  if (( i == ${#missing_files[@]} )); then
    sep=""
  fi
  print "    \"${missing_files[$i]}\"$sep"
done
print "  ],"
print "  \"missingHooks\": ["
for (( i = 1; i <= ${#missing_hooks[@]}; i++ )); do
  sep=","
  if (( i == ${#missing_hooks[@]} )); then
    sep=""
  fi
  print "    \"${missing_hooks[$i]}\"$sep"
done
print "  ]"
print "}"
