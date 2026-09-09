#!/usr/bin/env bash
set -euo pipefail
export AVALONIA_TELEMETRY_OPTOUT=1
export DOTNET_CLI_TELEMETRY_OPTOUT=1
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
dotnet_bin="${DOTNET_BIN:-dotnet}"
output="$repo_root/artifacts/windows-x64"
"$dotnet_bin" publish "$repo_root/apps/classroom/Broadcast.Classroom/Broadcast.Classroom.csproj" \
  -c Release -r win-x64 --self-contained true -o "$output" \
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:PublishTrimmed=false
cp "$repo_root/docs/WINDOWS-使用说明.md" "$output/README.zh-CN.md"
cd "$repo_root/artifacts"
rm -f ".Broadcast.Classroom-win-x64.tmp.zip"
zip -j -q ".Broadcast.Classroom-win-x64.tmp.zip" "windows-x64/Broadcast.Classroom.exe" "windows-x64/appsettings.json" "windows-x64/README.zh-CN.md"
mv -f ".Broadcast.Classroom-win-x64.tmp.zip" "Broadcast.Classroom-win-x64.zip"
shasum -a 256 "windows-x64/Broadcast.Classroom.exe" "Broadcast.Classroom-win-x64.zip" > SHA256SUMS.txt
printf 'Windows executable: %s/Broadcast.Classroom.exe\n' "$output"
