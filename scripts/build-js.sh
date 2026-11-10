#!/bin/bash
# build-js.sh — 조각을 이름 순으로 이어 붙여 배포 JS 를 만든다.
#
#   scripts/build-js.sh          결합 결과로 배포 파일을 쓴다
#   scripts/build-js.sh --check  파일을 쓰지 않고, 배포 파일이 결합 결과와 같은지만 본다 (같으면 0, 다르면 1)
#
# 묶음 (1.7.0):
#   global : resources/js/src/*.js   → dist/js/plugin.iife.js, resources/js/index.js (두 파일은 항상 같다 — plugin.json assets.js)
#   view   : resources/js/view/*.js  → dist/js/view.js   (글 보기 기능, 켜졌을 때만 불러온다)
#   write  : resources/js/write/*.js → dist/js/write.js  (글쓰기 도우미, 켜졌을 때만 불러온다)
#
# - 조각은 하나의 IIFE 를 줄 경계에서 자른 것이라 혼자서는 완결된 스크립트가 아니다.
#   조각을 고친 뒤에는 반드시 이 스크립트로 배포 파일을 다시 만든다.
# - cat 외 도구를 쓰지 않는다(npm·번들러 없음). 결과는 새 임시 파일에 먼저 쓰고 교체한다.
set -euo pipefail
export LC_ALL=C

root=$(cd "$(dirname "$0")/.." && pwd)

mode=build
case "${1:-}" in
  '') ;;
  --check) mode=check ;;
  *) echo "usage: $0 [--check]" >&2; exit 2 ;;
esac

work=$(mktemp -d "$root/dist/js/.build.XXXXXX")
trap 'rm -rf "$work"' EXIT

status=0
i=0

# build_bundle <조각 폴더(저장소 기준)> <배포 파일…>
build_bundle() {
  local srcdir="$root/$1"
  shift
  shopt -s nullglob
  local parts=("$srcdir"/*.js)
  shopt -u nullglob
  [ ${#parts[@]} -gt 0 ] || { echo "no parts in ${srcdir#"$root"/}" >&2; exit 2; }
  local combined="$work/combined.$i"
  cat "${parts[@]}" > "$combined"
  local t rel
  for t in "$@"; do
    t="$root/$t"
    rel=${t#"$root"/}
    i=$((i + 1))
    if [ -f "$t" ] && cmp -s "$combined" "$t"; then
      echo "up to date: $rel"
      continue
    fi
    if [ "$mode" = check ]; then
      echo "OUT OF DATE: $rel"
      status=1
      continue
    fi
    cat "$combined" > "$work/out.$i"
    cmp -s "$combined" "$work/out.$i" || { echo "copy mismatch: $rel" >&2; exit 1; }
    if [ -f "$t" ]; then chmod --reference="$t" "$work/out.$i" 2>/dev/null || true; else chmod 644 "$work/out.$i"; fi
    mv -f "$work/out.$i" "$t"
    echo "written: $rel"
  done
  i=$((i + 1))
}

build_bundle resources/js/src dist/js/plugin.iife.js resources/js/index.js
build_bundle resources/js/view dist/js/view.js
build_bundle resources/js/write dist/js/write.js

exit "$status"
