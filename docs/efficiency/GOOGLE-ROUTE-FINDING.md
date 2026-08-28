# The Google brain route: settled, do not reopen casually

**Date:** 2026-08-23 | **Time box:** 15 minutes, honored
**Status:** CLOSED. gemini CLI permanently retired; Antigravity has no headless path.

---

## 1. gemini CLI — PERMANENTLY RETIRED

One honest probe, exact output:

```
$ gemini -p "Return exactly AUTH_OK"
exit=1  elapsed_ms=2599

Error authenticating: IneligibleTierError: This client is no longer supported
for Gemini Code Assist for individuals. To continue using Gemini, please
migrate to the Antigravity suite of products: https://antigravity.google
    at throwIneligibleOrProjectIdError (.../@google/gemini-cli/bundle/chunk-32XQ54AJ.js:310030:11)
```

gemini CLI version 0.55.1.

**This is terminal, not transient.** Google ended Gemini Code Assist for
individuals; no retry, credential refresh, or version bump changes it. Per the
standing directive: never probe, benchmark, or scaffold against the gemini CLI
again, in any session or phase. It is removed from the E3 matrix.

## 2. Antigravity — NO-HEADLESS-PATH

Installed: `/Applications/Antigravity.app` and `/Applications/Antigravity IDE.app`
(Antigravity IDE 1.107.0). The only CLI entry point is
`/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide`,
a VS Code-derived launcher.

Its surface is editor operations: `--diff`, `--merge`, `--goto`,
`--install-extension`, `--add-mcp`, plus subcommands `chat`, `serve-web`,
`tunnel`.

`chat` looked like the candidate:

```
Usage: antigravity-ide chat [options] [prompt]
  -m --mode <mode>   'ask', 'edit', 'agent', or a custom mode. Defaults to 'agent'.
  -a --add-file <path>
  --maximize | -r --reuse-window | -n --new-window
```

Every option is window management. There is no `--output`, no `--json`, no
stdout flag. One honest attempt:

```
$ antigravity-ide chat --mode ask "Return exactly AUTH_OK"
exit=0  elapsed_ms=1277  bytes_of_output=0
```

It returns immediately having handed the prompt to the GUI. The model's answer
renders in the IDE chat view and never reaches stdout, so **nothing our adapter
interface can drive exists**. The adapter contract requires spawning a process
and parsing its output; Antigravity offers no such surface.

**Verdict: NO-HEADLESS-PATH.** The E3 trial runs without a Google brain.

## 3. What would reopen this, and only this

Not a hunch, and not a new Antigravity release in general. Only one of:

- Antigravity ships a documented non-interactive invocation that writes the
  model response to stdout or a file (e.g. an `--output`/`--json` flag on `chat`,
  or a headless subcommand).
- Google restores an individual-tier CLI, or Fritz moves to a tier whose CLI
  authenticates, in which case the exact `IneligibleTierError` above stops
  reproducing.

`serve-web` and `tunnel` were not pursued: both serve the editor UI over HTTP
rather than exposing a model endpoint, so they are a remote GUI, not a headless
brain. Recorded so the next session does not re-walk this path.

## 4. Fixable by Fritz

The gemini blocker is an **account-state** issue, not a code issue. Exact error
text is in section 1. Nothing in this repo can resolve it.
