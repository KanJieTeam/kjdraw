#!/bin/sh
set -eu

KJDRAW_SOURCE_SHA='466d8be59e1be68dea19043427b4ec9f6295c0ee'
KJDRAW_PROJECT="${KJDRAW_PROJECT:-$PWD}"
KJDRAW_DATA_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}"
KJDRAW_INSTALL="$KJDRAW_DATA_ROOT/kjdraw/source-466d8be"

case "$KJDRAW_PROJECT" in
  /*) ;;
  *) echo 'Run inside an existing project, or set KJDRAW_PROJECT to its absolute path.' >&2; exit 1 ;;
esac
[ -d "$KJDRAW_PROJECT" ] || { echo 'KJDraw project directory was not found.' >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo 'KJDraw requires Node.js 22 or newer.' >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo 'KJDraw requires Git.' >&2; exit 1; }
node -e 'if (+process.versions.node.split(".")[0] < 22) process.exit(1)'

if [ -e "$KJDRAW_INSTALL" ]; then
  [ -d "$KJDRAW_INSTALL/.git" ] || { echo 'Existing KJDraw install is not a source checkout.' >&2; exit 1; }
  [ "$(git -C "$KJDRAW_INSTALL" rev-parse HEAD)" = "$KJDRAW_SOURCE_SHA" ] || {
    echo 'Existing KJDraw install is not the pinned candidate.' >&2; exit 1;
  }
else
  mkdir -p "$(dirname "$KJDRAW_INSTALL")"
  git clone --filter=blob:none --no-checkout https://github.com/KanJieTeam/kjdraw.git "$KJDRAW_INSTALL"
  git -C "$KJDRAW_INSTALL" checkout --detach "$KJDRAW_SOURCE_SHA"
fi

KJDRAW_CONNECT="$KJDRAW_INSTALL/packages/kjdraw-sdk/bin/kjdraw-connect.mjs"
printf 'Installing KJDraw project configuration in: %s\n' "$KJDRAW_PROJECT"
if [ -f "$KJDRAW_PROJECT/.kjdraw/host.kjd" ]; then
  node "$KJDRAW_CONNECT" --all --apply --workspace "$KJDRAW_PROJECT" --input '.kjdraw/host.kjd'
else
  node "$KJDRAW_CONNECT" --all --apply --workspace "$KJDRAW_PROJECT" --blank '.kjdraw/host.kjd' --units millimeter
fi

printf '\nKJDraw project configuration is installed.\n'
printf '%s\n' 'Restart your AI client, open this project, and verify the kjdraw tool call. Ask:'
printf '%s\n' 'Use KJDraw to read the current drawing, then draw a circle with a 5 mm radius. Create a pending proposal only.'
printf '%s\n' '或者输入：'
printf '%s\n' '使用 KJDraw 读取当前图纸，然后画一个半径 5 mm 的圆；只生成待审核提案。'
