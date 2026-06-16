#!/usr/bin/env bash
# PostToolUse(Write|Edit) hook: syntax-check an edited .gs file — the Apps Script
# analog of prettier/typecheck-on-write. .gs is ES5-style JS that node can't read
# directly, so we copy to a temp .js and run `node --check`. No-op without node,
# for non-.gs files, or when the file is gone. Silent on success.
f=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
case "$f" in
  *.gs) ;;
  *) exit 0 ;;
esac
command -v node >/dev/null 2>&1 || exit 0
[ -f "$f" ] || exit 0
tmp="$(mktemp -d)"
cp "$f" "$tmp/x.js"
out=$(node --check "$tmp/x.js" 2>&1)
rc=$?
rm -rf "$tmp"
if [ "$rc" -ne 0 ]; then
  jq -n --arg f "$f" --arg o "$out" '{systemMessage: ("⚠️ Syntax error in " + $f + ":\n" + $o)}'
fi
exit 0
