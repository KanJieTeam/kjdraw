#!/bin/sh
set -eu

KJDRAW_SOURCE_SHA='80e29bb14d33d68aff024b7098c40116bccd224e'
KJDRAW_PROJECT="${KJDRAW_PROJECT:-$PWD}"
KJDRAW_DATA_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}"
KJDRAW_INSTALL="$KJDRAW_DATA_ROOT/kjdraw/source-80e29bb"

case "$KJDRAW_PROJECT" in
  /*) ;;
  *) echo 'Run inside an existing project, or set KJDRAW_PROJECT to its absolute path.' >&2; exit 1 ;;
esac
[ -d "$KJDRAW_PROJECT" ] || { echo 'KJDraw project directory was not found.' >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo 'KJDraw requires Node.js 22 or newer.' >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo 'KJDraw requires curl.' >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo 'KJDraw requires tar.' >&2; exit 1; }
node -e 'if (+process.versions.node.split(".")[0] < 22) process.exit(1)'

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
