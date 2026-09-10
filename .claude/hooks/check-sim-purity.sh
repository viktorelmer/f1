#!/usr/bin/env bash
# PostToolUse hook: keeps src/sim/ pure and deterministic (plan section 0, rule 2).
# Exit 2 sends stderr back to Claude as an error to fix.

file=$(jq -r '.tool_input.file_path // empty')

case "$file" in
  */src/sim/*.ts | */src/sim/*.tsx) ;;
  *) exit 0 ;;
esac

# Tests and benchmarks may measure wall-clock time (performance budget).
case "$file" in
  *.test.ts | *.spec.ts | *.bench.ts | *.test.tsx | *.spec.tsx) exit 0 ;;
esac

[ -f "$file" ] || exit 0

pattern='Math\.random|Date\.now|new Date\(|performance\.now|crypto\.(getRandomValues|randomUUID)'
pattern="$pattern|from ['\"](react|react-dom)(/[^'\"]*)?['\"]"
pattern="$pattern|from ['\"][^'\"]*\b(ui|app)/"

# Skip lines that are only comments, so documenting the rule doesn't trip it.
hits=$(grep -nE "$pattern" "$file" | grep -vE '^[0-9]+:[[:space:]]*(//|\*|/\*)')

if [ -n "$hits" ]; then
  {
    echo "src/sim/ must stay pure: no wall-clock time, no Math.random, no React, no imports from app/ or ui/."
    echo "Use the injected Rng stream and the passed-in game time instead."
    echo "$file:"
    echo "$hits"
  } >&2
  exit 2
fi

exit 0
