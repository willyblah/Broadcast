#!/usr/bin/env bash
set -euo pipefail
export AVALONIA_TELEMETRY_OPTOUT=1
export DOTNET_CLI_TELEMETRY_OPTOUT=1
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
dotnet_bin="${DOTNET_BIN:-dotnet}"
cd "$repo_root"
npm --prefix apps/teacher test
npm --prefix apps/teacher run build
npm --prefix apps/teacher run lint
deno check supabase/functions/broadcast-api/index.ts
deno test supabase/tests/domain_test.ts
"$dotnet_bin" run --project apps/classroom/Broadcast.Core.Tests
"$dotnet_bin" run --project apps/classroom/Broadcast.Visual.Tests -- "$repo_root/artifacts/visual-qa"
"$dotnet_bin" build apps/classroom/Broadcast.Classroom/Broadcast.Classroom.csproj -r win-x64
