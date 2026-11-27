# chromium-debug skill — design

Date: 2026-11-27
Location: `.claude/skills/chromium-debug/` in this repo
Platform: Linux (v1). macOS/Windows are out of scope for v1.

## Purpose

Let Claude launch a Chromium-based browser with remote debugging enabled and drive it through an extensible command harness: inspect elements (position, CSS, markup), take screenshots to check layout and make fine adjustments, and emulate mobile screen sizes. It replaces the one-off scripts that were previously rewritten for every check.

## Layout

```
.claude/skills/chromium-debug/
  SKILL.md              # when/how Claude uses it, first-run flow, command reference, "write a command"
  .config               # user preferences (JSON, gitignored)
  .gitignore            # .config, node_modules/
  package.json          # "playwright-core": "1.65.1" (exact pin)
  package-lock.json     # committed, integrity hashes; installed only via `npm ci`
  scripts/cdp.mjs       # single CLI entry point
  scripts/daemon.mjs    # background process holding the Playwright connection
  lib/                  # shared helpers (resolveElement, output paths, protocol, browsers, lifecycle)
  commands/*.mjs        # one file per command
  tests/                # node:test suites + fixture pages
```

## Dependencies

- Node ≥ 22.4 (this machine: v24.7). The PNG codec uses `zlib.crc32`, and the parser uses `parseArgs` `allowNegative`.
- `playwright-core` pinned exactly to `1.65.1` (released 2026-11-13), lockfile committed, installed with `npm ci` during setup. Only `playwright-core` — no bundled browser downloads.
- Nothing else. Argument parsing uses `node:util` `parseArgs`; tests use `node:test`.

## First-run setup

The CLI cannot prompt the user itself, so Claude runs the setup conversation, as described in SKILL.md, using CLI helper subcommands. Setup runs whenever `.config` is missing.

1. `cdp.mjs setup --install`: runs `npm ci` in the skill folder.
2. `cdp.mjs detect` → JSON list of known browsers that were found, with resolved paths and whether each is a Snap install. Known list: Chromium, Google Chrome, Brave, Microsoft Edge, Opera. Binary names checked: `chromium`, `chromium-browser`, `google-chrome`, `google-chrome-stable`, `brave-browser`, `brave`, `microsoft-edge`, `microsoft-edge-stable`, `opera`.
3. Claude asks a multi-select question listing the detected browsers. The question tool adds "Other" automatically. If more than 4 browsers are detected, Claude splits them across two questions.
4. If Other is chosen, Claude asks for the executable name or path, then runs `cdp.mjs setup --validate <exe>`. That resolves the executable on `PATH` or as an absolute path, checks it is executable, and runs `<exe> --version`. If any check fails, Claude reports the error and asks again.
5. Claude asks whether any selected browser needs extra launch arguments, and records them per browser.
6. `cdp.mjs setup --write '<json>'` validates and writes `.config`.

`.config` format:
```json
{
  "version": 1,
  "browsers": [
    { "id": "brave", "label": "Brave", "exe": "/usr/bin/brave-browser", "snap": null, "args": [] }
  ]
}
```

Launch selection: if `.config` has exactly one browser, `launch` always uses it. If it has several, Claude asks the user which one, then runs `launch <id>`.

## Launch

- **Profile directory:** each browser gets its own dedicated profile, never the user's default. Recent Chrome versions ignore remote debugging on the default profile.
  - Snap browsers: `~/snap/<snap-name>/common/chromium-debug-profile/`. Snap confinement blocks hidden directories in home.
  - Other browsers: `~/.local/share/chromium-debug/chromium-debug-profile-<id>/`.
- **Flags:** `--remote-debugging-port=0 --user-data-dir=<profile> --no-first-run --no-default-browser-check`, plus the browser's `args` from `.config`. With port `0`, the browser picks a free port and writes it to `<profile>/DevToolsActivePort`. The daemon reads that file, so ports never conflict. Chromium binds the debug port to 127.0.0.1.
- **Stale locks:** before spawning, the daemon kills any process still using the profile and deletes `SingletonLock`/`SingletonSocket`/`SingletonCookie`. A SIGKILLed browser leaves these behind, and Chromium then refuses to start.
- **One session at a time.** `launch` while a session is already running returns the existing session's status. If a different browser is requested, it errors with "run stop first".
- Playwright attaches via `chromium.connectOverCDP(http://127.0.0.1:<port>)`.

## Daemon and lifecycle

`launch` starts `daemon.mjs` fully detached (`setsid`, stdio to a log file). The daemon spawns the browser as its own child in its own process group, connects Playwright, and listens on a Unix socket.

Runtime files are kept in `$XDG_RUNTIME_DIR/chromium-debug/`, or `os.tmpdir()/chromium-debug-<uid>/` if that variable is unset. The directory is mode 0700 and holds:
- `daemon.sock` (mode 0600). If the path would exceed the ~108-byte Unix socket limit, it moves to `/tmp/chromium-debug-<uid>-<hash>.sock`.
- `daemon.pid`
- `state.json` (browser id, browser pid, pgid, port, profile)
- `daemon.log`

**Shutdown triggers.** Any one of these ends the session:
1. The browser child process exits (user closed it, or it crashed). Wrapper launchers (e.g. Brave's shell script) may sit between the daemon and the browser, so this trigger fires only if, one second later, the connection is down or no process uses the profile.
2. Playwright `browser.on('disconnected')` fires.
3. The browser has had no open page targets for 3 s. This covers browsers that keep running in the background after the last window is closed.
4. The `stop` command, or SIGTERM / SIGINT / SIGHUP sent to the daemon.

**Process matching:** "processes using the profile" means command lines containing `--user-data-dir=<profile>`, matched on the space-joined command line with a boundary check. Snap Chromium rewrites its process title into a single string, so exact argv matching misses it.

**Shutdown sequence:** close the browser if it is still running. Wait up to 5 s, then `kill -- -<pgid>` with SIGKILL so GPU, renderer and other helper processes go too. Close the socket, delete the pid, state and socket files, and exit. Node reaps the child; the detached daemon is reaped by PID 1.

**Stale-session recovery** (the daemon was SIGKILLed or crashed): every CLI call checks `daemon.pid` first. If the daemon is dead, the CLI kills any surviving browser process group recorded in `state.json`, removes the stale runtime files, and then continues (`launch`) or reports "no session" (other commands).

Requirement: no daemon, browser, or browser helper process survives any of these scenarios.

## CLI and protocol

`node scripts/cdp.mjs <command> [positional...] [--flags]`

- The CLI handles `setup`, `detect`, `launch [id]`, `status`, `stop` and `help [cmd]` itself. Every other command is forwarded to the daemon as newline-delimited JSON over the socket: `{ "cmd": "...", "args": {...} }`.
- Every call prints one JSON object to stdout. Exit code is 0 on success and 1 on error.
  - `{ "ok": true, "command": "inspect", "tab": "A1F3", "result": {...} }`
  - `{ "ok": false, "command": "inspect", "error": { "code": "NO_MATCH", "message": "#nav matched 0 elements" } }`
- Error codes: `NO_SESSION`, `SESSION_ACTIVE`, `BROWSER_CHOICE_REQUIRED`, `LAUNCH_FAILED`, `NO_PAGE`, `NO_MATCH`, `AMBIGUOUS_MATCH`, `BAD_ARGS`, `UNKNOWN_COMMAND`, `TIMEOUT`, `BROWSER_ERROR`, `CONFIG_MISSING`, `CONFIG_INVALID`, `DEPS_MISSING`, `EXE_NOT_FOUND`.
- Default timeout per command: 15 s, overridable with `--timeout`.

## Command module interface

```js
export default {
  name: 'inspect',
  description: 'Box model, key computed styles and attributes for one element',
  args: {
    selector: { type: 'string', positional: 0, required: true },
    props:    { type: 'string', multiple: true, description: 'extra CSS properties' },
    nth:      { type: 'string', description: 'pick the Nth match if several' },
  },
  async run({ page, cdp, tab, state, session, args, cwd, out }) { return { /* JSON-safe */ }; },
};
```

- The daemon loads `commands/*.mjs` at startup and validates each module's shape. A bad module is logged and skipped; it does not crash the daemon. `help` is generated from the module metadata.
- `args` drives `util.parseArgs` in the CLI. Positional arguments are mapped by their `positional` index.
- What `run()` receives:
  - `page`: Playwright page for the current tab.
  - `cdp`: a `CDPSession` for that page.
  - `state`: daemon memory. Holds the console buffer, per-tab emulation settings, injected CSS ids, and screenshot history.
  - `out`: `out.path(name, ext)` returns a file path in the output directory, and `out.dir` is that directory.
  - `tab`: `{ id, page, cdp, emulation }` for the target tab.
  - `session`: `tabs()`, `select(id)`, `newTab(url)`, `resetEmulation(tab)`, `browser`.
  - `cwd`: the caller's working directory.
- Optional `noPage: true` marks commands that don't need a tab (`tabs`, `tab`, `newtab`, `diff`, `console`).
- `lib/resolveElement(page, selector, { nth })` throws `NO_MATCH` when nothing matches. When several elements match and `nth` isn't given, it throws `AMBIGUOUS_MATCH` with the match count.
- New commands take effect after `stop` + `launch` (the daemon loads modules once).

## Starting command set

| Group | Commands |
|---|---|
| Lifecycle (CLI) | `setup`, `detect`, `launch [id]`, `status`, `stop`, `help [cmd]` |
| Navigation | `goto <url>`, `reload`, `wait <selector> \| --network-idle \| --ms N`, `tabs`, `tab <id>`, `newtab [url]` |
| Inspection | `inspect <sel>` (box/position, key computed styles, attributes), `html <sel> [--inner]`, `css <sel> --props a,b \| --all`, `at <x> <y>`, `overflow` (elements extending past viewport width), `eval <js>` |
| Visual | `screenshot [--full \| --selector S] [--name N]`, `diff <a> <b>`, `css-inject <css> [--id X]`, `css-remove [--id X]` |
| Emulation | `viewport <W>x<H> [--dpr N]`, `device <preset>`, `media [--color-scheme light\|dark] [--reduced-motion] [--print]`, `emulate --reset` |
| Interaction | `click <sel>`, `type <sel> <text>`, `hover <sel>`, `scroll <sel> \| --to x,y` |
| Logs | `console [--errors] [--since <iso>] [--clear]` |

Notes:
- **Screenshots and diffs** are written to `./tmp/chromium-debug/` relative to the caller's working directory (created if missing), or to `--out`. The result includes the absolute path, so Claude can open the image with Read.
- **`diff`** runs in Node using a small PNG codec on `node:zlib` (`lib/png.mjs`) instead of a canvas in a temporary tab, so no tab flashes on screen. It counts changed pixels (per-channel tolerance `--threshold`, default 0), writes a diff PNG with changes in red over a faded original, and returns `{ changedPixels, totalPixels, changedPercent, bbox, diffPath }`. Images of different sizes produce an error.
- **`screenshot`** uses `Page.captureScreenshot` on our CDP session, so it reflects the emulation. It never uses `captureBeyondViewport`: Chromium leaves scrollbars hidden after that until the next reload, which corrupts later diffs. Full-page shots, and element shots larger than the viewport, temporarily stretch the emulated viewport to the page height and then restore the tab's exact emulation.
- **`device`** uses Playwright's built-in `devices` list. It applies settings to the current tab through CDP: `Emulation.setDeviceMetricsOverride`, `setUserAgentOverride`, `setTouchEmulationEnabled`. A new context isn't possible with connectOverCDP's default context. Emulation is per tab and stored in `state`. It stays in effect while the daemon is connected.
- **`console`** messages and uncaught page errors are captured by the daemon for every tab in a ring buffer of the last 1000 entries.
- **`css-inject`** goes through the CDP CSS domain (`CSS.createStyleSheet` + `setStyleSheetText`), so a page's Content-Security-Policy can't block it. It uses a dedicated CDP session, so `emulate --reset` leaves it alone. The same `--id` replaces the earlier text. `css-remove` without `--id` removes all injected styles. Navigation drops injected CSS.

## Testing

Run with `npm test`. Every test session uses its own config, runtime dir and profile (via `CDBG_CONFIG`, `CDBG_RUNTIME_DIR`, `CDBG_PROFILE_NAME`). Browsers run headless by default; `CDBG_TEST_HEADFUL=1` shows windows and `CDBG_TEST_BROWSERS` picks which installed browsers to test.

All tests use `node:test` and run against real browsers on this machine (Chromium Snap, Brave). Fixture pages live in `tests/fixtures/` and are served by a small `node:http` server started in the test.

- **Lifecycle** (`tests/lifecycle.test.mjs`): for each scenario, assert that afterwards `pgrep -f <profile-dir>` and `pgrep -f daemon.mjs` both find nothing and that `daemon.sock` is gone.
  1. `Browser.close` sent over CDP (the user closing the window)
  2. SIGKILL to the browser
  3. all tabs closed while the browser keeps running
  4. `stop`
  5. SIGKILL to the daemon, then a CLI call (stale-session recovery)
  6. SIGTERM to the daemon
- **Commands:** a smoke test per command against the fixtures, covering the result shape and the error codes (`NO_MATCH`, `AMBIGUOUS_MATCH`, `BAD_ARGS`).
- **Setup:** `detect` finds the installed browsers. `--validate` rejects a missing executable and a non-executable file. `--write` rejects malformed JSON.

## Out of scope (v1)

macOS/Windows, Flatpak auto-detection (Flatpak browsers can be added via Other only if they expose a runnable executable), multiple concurrent sessions, network/CPU throttling, performance metrics, accessibility tree, cookies/storage commands, hot-reloading command modules.
