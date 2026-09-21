#!/usr/bin/env bash
set -euo pipefail

# macOS Ruby provides safe_load but not necessarily safe_load_file.
# Capability discovery may fall back; a parsing failure must never fall back.
if command -v ruby >/dev/null 2>&1 &&
  ruby -ryaml -e 'exit(YAML.respond_to?(:safe_load) ? 0 : 1)' 2>/dev/null; then
  ruby -ryaml -e 'ARGV.each { |file| YAML.safe_load(File.read(file), aliases: false) }' "$@"
elif command -v python3 >/dev/null 2>&1 && python3 -c 'import yaml' 2>/dev/null; then
  python3 -c '
import sys, yaml
for path in sys.argv[1:]:
    with open(path, encoding="utf-8") as stream:
        content = stream.read()
    if any(isinstance(token, yaml.tokens.AliasToken) for token in yaml.scan(content)):
        raise ValueError("YAML aliases are forbidden")
    yaml.safe_load(content)
' "$@"
else
  printf 'no safe YAML parser is available; validation refused\n' >&2
  exit 1
fi
