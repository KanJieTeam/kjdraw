#!/bin/sh
set -eu

KJDRAW_SOURCE_SHA='734a7f4df511fe5828444df556e4c8e92621cd06'
command -v node >/dev/null 2>&1 || { echo 'KJDraw requires Node.js 22 or newer.' >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo 'KJDraw requires curl.' >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo 'KJDraw requires tar.' >&2; exit 1; }
node -e 'if (+process.versions.node.split(".")[0] < 22) process.exit(1)'
KJDRAW_USER_HOME="${KJDRAW_USER_HOME:-$(node -p 'require("node:os").homedir()')}"
KJDRAW_DATA_ROOT="${XDG_DATA_HOME:-$KJDRAW_USER_HOME/.local/share}"
KJDRAW_INSTALL="$KJDRAW_DATA_ROOT/kjdraw/source-734a7f4"
KJDRAW_PREVIOUS_4C7="$KJDRAW_DATA_ROOT/kjdraw/source-4c7124e/packages/kjdraw-sdk/bin/kjdraw-mcp.mjs"
KJDRAW_PREVIOUS_0C2="$KJDRAW_DATA_ROOT/kjdraw/source-0c2d86e/packages/kjdraw-sdk/bin/kjdraw-mcp.mjs"
KJDRAW_PREVIOUS_57E="$KJDRAW_DATA_ROOT/kjdraw/source-57e0697/packages/kjdraw-sdk/bin/kjdraw-mcp.mjs"
KJDRAW_PREVIOUS_1854="$KJDRAW_DATA_ROOT/kjdraw/source-1854240/packages/kjdraw-sdk/bin/kjdraw-mcp.mjs"
KJDRAW_PREVIOUS_5F65="$KJDRAW_DATA_ROOT/kjdraw/source-5f655c2/packages/kjdraw-sdk/bin/kjdraw-mcp.mjs"
KJDRAW_PREVIOUS_69BE="$KJDRAW_DATA_ROOT/kjdraw/source-69bec87/packages/kjdraw-sdk/bin/kjdraw-mcp.mjs"
KJDRAW_PREVIOUS_7B25="$KJDRAW_DATA_ROOT/kjdraw/source-7b25cf4/packages/kjdraw-sdk/bin/kjdraw-mcp.mjs"
KJDRAW_PREVIOUS_B022="$KJDRAW_DATA_ROOT/kjdraw/source-b022932/packages/kjdraw-sdk/bin/kjdraw-mcp.mjs"
KJDRAW_PREVIOUS_6DA="$KJDRAW_DATA_ROOT/kjdraw/source-6da40b2/packages/kjdraw-sdk/bin/kjdraw-mcp.mjs"
KJDRAW_PREVIOUS_85D="$KJDRAW_DATA_ROOT/kjdraw/source-85d750e/packages/kjdraw-sdk/bin/kjdraw-mcp.mjs"
KJDRAW_PREVIOUS_C526="$KJDRAW_DATA_ROOT/kjdraw/source-c526aa7/packages/kjdraw-sdk/bin/kjdraw-mcp.mjs"
KJDRAW_PREVIOUS_A3C1="$KJDRAW_DATA_ROOT/kjdraw/source-a3c1bca/packages/kjdraw-sdk/bin/kjdraw-mcp.mjs"
KJDRAW_PREVIOUS_71DF="$KJDRAW_DATA_ROOT/kjdraw/source-71df822/packages/kjdraw-sdk/bin/kjdraw-mcp.mjs"
KJDRAW_PREVIOUS_616133E="$KJDRAW_DATA_ROOT/kjdraw/source-616133e/packages/kjdraw-sdk/bin/kjdraw-mcp.mjs"

case "$KJDRAW_USER_HOME" in
  /*) ;;
  *) echo 'The current user home directory could not be resolved safely.' >&2; exit 1 ;;
esac
[ -d "$KJDRAW_USER_HOME" ] || { echo 'The current user home directory was not found.' >&2; exit 1; }

if [ -e "$KJDRAW_INSTALL" ]; then
  if [ -f "$KJDRAW_INSTALL/.kjdraw-source-sha" ]; then
    KJDRAW_ACTUAL=$(cat "$KJDRAW_INSTALL/.kjdraw-source-sha")
  elif [ -d "$KJDRAW_INSTALL/.git" ] && command -v git >/dev/null 2>&1; then
    KJDRAW_ACTUAL=$(git -C "$KJDRAW_INSTALL" rev-parse HEAD)
  else
    KJDRAW_ACTUAL=''
  fi
  [ "$KJDRAW_ACTUAL" = "$KJDRAW_SOURCE_SHA" ] || {
    echo 'Existing KJDraw install is not the pinned candidate.' >&2; exit 1;
  }
else
  mkdir -p "$(dirname "$KJDRAW_INSTALL")"
  KJDRAW_STAGE="$KJDRAW_INSTALL.stage.$$"
  KJDRAW_ARCHIVE="$KJDRAW_STAGE.tar.gz"
  [ ! -e "$KJDRAW_STAGE" ] && [ ! -e "$KJDRAW_ARCHIVE" ] || {
    echo 'A KJDraw installer staging path already exists; refusing overwrite.' >&2; exit 1;
  }
  trap 'rm -f "$KJDRAW_ARCHIVE"; rm -rf "$KJDRAW_STAGE"' 0 HUP INT TERM
  curl -fsSL "https://codeload.github.com/KanJieTeam/kjdraw/tar.gz/$KJDRAW_SOURCE_SHA" -o "$KJDRAW_ARCHIVE"
  mkdir "$KJDRAW_STAGE"
  tar -xzf "$KJDRAW_ARCHIVE" -C "$KJDRAW_STAGE" --strip-components=1
  printf '%s' "$KJDRAW_SOURCE_SHA" > "$KJDRAW_STAGE/.kjdraw-source-sha"
  mv "$KJDRAW_STAGE" "$KJDRAW_INSTALL"
  rm -f "$KJDRAW_ARCHIVE"
  trap - 0 HUP INT TERM
fi

KJDRAW_CONNECT="$KJDRAW_INSTALL/packages/kjdraw-sdk/bin/kjdraw-connect.mjs"
KJDRAW_MCP="$KJDRAW_INSTALL/packages/kjdraw-sdk/bin/kjdraw-mcp.mjs"
printf 'Installing KJDraw user configuration in: %s\n' "$KJDRAW_USER_HOME"
KJDRAW_SCHEMA_CHECK=$(node "$KJDRAW_MCP" --check-tool-schemas) || {
  echo 'KJDraw MCP tool schemas failed compatibility validation; no client configuration was changed.' >&2
  exit 1
}
printf '%s' "$KJDRAW_SCHEMA_CHECK" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const r=JSON.parse(s);if(!r.ok||r.profile!=="moonshot-walle-compatible-v1")process.exit(1)})' || {
  echo 'KJDraw MCP tool schemas are not compatible with the installed Kimi Code integration; no client configuration was changed.' >&2
  exit 1
}
if [ -f "$KJDRAW_USER_HOME/.kjdraw/host.kjd" ]; then
  set -- --all --apply --scope user --workspace "$KJDRAW_USER_HOME" --input '.kjdraw/host.kjd' --candidate-dir '.kjdraw/results'
else
  set -- --all --apply --scope user --workspace "$KJDRAW_USER_HOME" --blank '.kjdraw/host.kjd' --units millimeter --candidate-dir '.kjdraw/results'
fi
# This is the official KJDraw installer, so an existing `kjdraw` entry is
# managed by KJDraw and may be replaced. The connector only replaces that
# named entry; unrelated MCP servers remain untouched. Unknown conflicts in
# other files still fail atomically inside kjdraw-connect.
set -- "$@" --replace-existing
if [ -f "$KJDRAW_PREVIOUS_4C7" ]; then set -- "$@" --previous-mcp-script "$KJDRAW_PREVIOUS_4C7"; fi
if [ -f "$KJDRAW_PREVIOUS_0C2" ]; then set -- "$@" --previous-mcp-script "$KJDRAW_PREVIOUS_0C2"; fi
if [ -f "$KJDRAW_PREVIOUS_57E" ]; then set -- "$@" --previous-mcp-script "$KJDRAW_PREVIOUS_57E"; fi
if [ -f "$KJDRAW_PREVIOUS_1854" ]; then set -- "$@" --previous-mcp-script "$KJDRAW_PREVIOUS_1854"; fi
if [ -f "$KJDRAW_PREVIOUS_5F65" ]; then set -- "$@" --previous-mcp-script "$KJDRAW_PREVIOUS_5F65"; fi
if [ -f "$KJDRAW_PREVIOUS_69BE" ]; then set -- "$@" --previous-mcp-script "$KJDRAW_PREVIOUS_69BE"; fi
if [ -f "$KJDRAW_PREVIOUS_7B25" ]; then set -- "$@" --previous-mcp-script "$KJDRAW_PREVIOUS_7B25"; fi
if [ -f "$KJDRAW_PREVIOUS_B022" ]; then set -- "$@" --previous-mcp-script "$KJDRAW_PREVIOUS_B022"; fi
if [ -f "$KJDRAW_PREVIOUS_6DA" ]; then set -- "$@" --previous-mcp-script "$KJDRAW_PREVIOUS_6DA"; fi
if [ -f "$KJDRAW_PREVIOUS_85D" ]; then set -- "$@" --previous-mcp-script "$KJDRAW_PREVIOUS_85D"; fi
if [ -f "$KJDRAW_PREVIOUS_C526" ]; then set -- "$@" --previous-mcp-script "$KJDRAW_PREVIOUS_C526"; fi
if [ -f "$KJDRAW_PREVIOUS_A3C1" ]; then set -- "$@" --previous-mcp-script "$KJDRAW_PREVIOUS_A3C1"; fi
if [ -f "$KJDRAW_PREVIOUS_71DF" ]; then set -- "$@" --previous-mcp-script "$KJDRAW_PREVIOUS_71DF"; fi
if [ -f "$KJDRAW_PREVIOUS_616133E" ]; then set -- "$@" --previous-mcp-script "$KJDRAW_PREVIOUS_616133E"; fi
KJDRAW_RESULT=$(node "$KJDRAW_CONNECT" "$@")
KJDRAW_TRAE_URL=$(printf '%s' "$KJDRAW_RESULT" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const r=JSON.parse(s);process.stdout.write(r.clients.find(x=>x.client==="TraeCode")?.installUrl||"")})')
if [ -n "$KJDRAW_TRAE_URL" ]; then
  printf '%s' "$KJDRAW_TRAE_URL" > "$KJDRAW_USER_HOME/.kjdraw/trae-install-url.txt"
  if [ -z "${KJDRAW_NO_OPEN_TRAE:-}" ]; then
    if command -v open >/dev/null 2>&1; then open "$KJDRAW_TRAE_URL" >/dev/null 2>&1 || true
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$KJDRAW_TRAE_URL" >/dev/null 2>&1 || true
    fi
  fi
fi

printf '\nKJDraw user configuration is installed.\n'
printf '%s\n' 'Restart Kimi Code, WorkBuddy, or ZCode and verify the kjdraw tool call in any workspace. TraeCode uses its official import confirmation.'
printf '%s\n' 'Ask:'
printf '%s\n' 'Use KJDraw to draw a circle with a 5 mm radius.'
printf '%s\n' '或者输入：用 KJDraw 画一个半径 5 毫米的圆。'
