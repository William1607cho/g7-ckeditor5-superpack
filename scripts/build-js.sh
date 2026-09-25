#!/bin/bash
# build-js.sh — resources/js/src/*.js 를 이름 순으로 이어 붙여 배포 JS 를 만든다.
#
#   scripts/build-js.sh          결합 결과로 dist/js/plugin.iife.js 와 resources/js/index.js 를 쓴다
#   scripts/build-js.sh --check  파일을 쓰지 않고, 두 파일이 결합 결과와 같은지만 본다 (같으면 0, 다르면 1)
#
# - 두 파일은 항상 바이트 단위로 같다(plugin.json 의 assets.js.entry·output).
# - 조각은 하나의 IIFE 를 줄 경계에서 자른 것이라 혼자서는 완결된 스크립트가 아니다.
#   조각을 고친 뒤에는 반드시 이 스크립트로 두 파일을 다시 만든다.
# - cat 외 도구를 쓰지 않는다(npm·번들러 없음). 결과는 새 임시 파일에 먼저 쓰고 교체한다.
set -euo pipefail
export LC_ALL=C

root=$(cd "$(dirname "$0")/.." && pwd)
src="$root/resources/js/src"
targets=("$root/dist/js/plugin.iife.js" "$root/resources/js/index.js")

mode=build
case "${1:-}" in
  '') ;;
  --check) mode=check ;;
  *) echo "usage: $0 [--check]" >&2; exit 2 ;;
esac

shopt -s nullglob
parts=("$src"/*.js)
[ ${#parts[@]} -gt 0 ] || { echo "no parts in ${src#"$root"/}" >&2; exit 2; }

work=$(mktemp -d "$root/dist/js/.build.XXXXXX")
trap 'rm -rf "$work"' EXIT
cat "${parts[@]}" > "$work/combined.js"

status=0
i=0
for t in "${targets[@]}"; do
  rel=${t#"$root"/}
  if [ -f "$t" ] && cmp -s "$work/combined.js" "$t"; then
    echo "up to date: $rel"
    continue
  fi
  if [ "$mode" = check ]; then
    echo "OUT OF DATE: $rel"
    status=1
    continue
  fi
  i=$((i + 1))
  cat "$work/combined.js" > "$work/out.$i"
  cmp -s "$work/combined.js" "$work/out.$i" || { echo "copy mismatch: $rel" >&2; exit 1; }
  [ -f "$t" ] && chmod --reference="$t" "$work/out.$i" 2>/dev/null || true
  mv -f "$work/out.$i" "$t"
  echo "written: $rel"
done

exit "$status"
