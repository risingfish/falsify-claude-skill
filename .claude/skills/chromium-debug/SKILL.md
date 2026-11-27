---
name: chromium-debug
description: Launch a Chromium-based browser (Chromium, Chrome, Brave, Edge, Opera, or another) in remote-debugging mode and drive it from the command line — inspect element position, CSS and markup, take viewport/full-page/element screenshots and pixel-diff them, try CSS tweaks live, emulate phones/tablets/viewport sizes/dark mode, click and type, and read console errors. Use when checking or fine-tuning a web page's layout or styling, testing a site at mobile sizes, debugging why something renders wrong, or whenever the user asks to open, look at, or poke at a page in a real browser.
---

# chromium-debug

A persistent browser session you drive with one CLI. A small background process owns the browser and the
connection, so viewport/device emulation, injected CSS and captured console output survive between calls. When the
user closes the browser, everything shuts down on its own — no leftover processes.

All commands go through one script in this skill's folder (use the skill's base directory):

```bash
CDP="node <skill-base-dir>/scripts/cdp.mjs"
$CDP help                # every command, one line each
$CDP help screenshot     # flags for one command
```

Every call prints one JSON object: `{"ok":true,"command":...,"tab":...,"result":{...}}` or
`{"ok":false,"error":{"code":"NO_MATCH","message":...}}` with a non-zero exit code. Only `help` prints plain text.

## First run: setup

Run `$CDP setup`. If `result.deps.installed` is false, run `$CDP setup --install` (installs the pinned
`playwright-core` with `npm ci`). If `result.config` is null, walk the user through this before doing anything else:

1. `$CDP detect` → the known browsers installed on this machine.
2. Ask with **AskUserQuestion**, `multiSelect: true`: "Which Chromium-based browsers do you want to use?" Offer the
   detected browsers as options (the label plus the path in the description). The tool adds **Other** by itself.
   The tool allows at most 4 options per question; if more than 4 are detected, split them over two questions in
   the same call. If none are detected, ask only for the executable (step 3).
3. If they chose **Other**, ask for the executable name or path, then run `$CDP setup --validate <exe>`. On
   `EXE_NOT_FOUND`, tell them what failed and ask again. On success use the returned `exe` (absolute path) and `snap`.
4. Ask once whether any of the chosen browsers need extra launch arguments (e.g. `--start-maximized`,
   `--disable-extensions`, `--proxy-server=...`). Record them per browser; default is none.
5. Save with `$CDP setup --write '<json>'`:
   ```json
   {"version":1,"browsers":[
     {"id":"brave","label":"Brave","exe":"/usr/bin/brave-browser","snap":null,"args":[]},
     {"id":"chromium","label":"Chromium","exe":"/snap/bin/chromium","snap":"chromium","args":["--start-maximized"]}
   ]}
   ```
   `id` is lowercase kebab-case (use the `detect` id, or a slug of the executable name for Other). `exe` and `snap`
   come straight from `detect` / `--validate`.

The config lives in `.config` in the skill folder (gitignored). To change it later, run the same flow again.

## Starting and stopping

```bash
$CDP launch          # one browser configured -> launches it
$CDP launch brave    # several configured -> REQUIRED: ask the user which one first (AskUserQuestion), then pass its id
$CDP status          # running?, tabs, current tab, emulation per tab
$CDP stop            # closes the browser and the background process
```

- With several browsers configured, a bare `launch` returns `BROWSER_CHOICE_REQUIRED` with the choices. Always ask
  the user; never pick for them.
- `launch` while a session runs returns it (`alreadyRunning: true`); a different browser needs `stop` first.
- The browser uses its own debug profile, not the user's everyday one, so they won't be signed in to anything.
  If they need to be, they can sign in inside the debug window once; the profile is kept between sessions.
- If the user closes the browser window, the session ends by itself; the next command returns `NO_SESSION`. Just
  `launch` again.
- Stop the session when you're done, unless the user wants to keep using the window.

## Commands

Selectors are Playwright selectors (CSS, plus `text=Sign in`, `role=button[name="Save"]`, etc.). A selector that
matches several elements is an error (`AMBIGUOUS_MATCH` with the count) — pass `--nth N` (0-based) or tighten it.

| Group | Commands |
|---|---|
| Navigate | `goto <url>` (bare `localhost:3000` gets `http://`), `reload`, `wait <selector> \| --network-idle \| --ms N`, `tabs`, `tab <id>`, `newtab [url]` |
| Inspect | `inspect <sel>` (rect, document rect, visibility, key computed styles, attributes, text), `html <sel> [--inner]`, `css <sel> --props a,b \| --all`, `at <x> <y>` (what's stacked at a point), `overflow` (what causes horizontal scroll), `eval <js>` |
| Visual | `screenshot [--full \| --selector S] [--name N]`, `diff <a> <b>`, `css-inject <css> [--id X]` / `--file f.css`, `css-remove [--id X]` |
| Emulate | `viewport 390x844 [--dpr 3] [--mobile]`, `device "<name>" [--reload]`, `device --list [filter]`, `media --color-scheme dark --reduced-motion --print` (`--no-<flag>` to undo), `emulate [--reset]` |
| Interact | `click <sel>`, `type <sel> <text> [--enter]`, `hover <sel>`, `scroll <sel> \| --to x,y \| --by dx,dy` |
| Logs | `console [--errors] [--since <iso>] [--limit N] [--clear]` |

Every browser command also takes `--timeout <ms>` (default 15000), `--tab <id>` (target another tab without
switching), and `--out <dir>`.

**Files:** screenshots and diffs go to `./tmp/chromium-debug/` under the current working directory (or `--out`).
Results carry the absolute `path`; **open it with the Read tool to actually look at the page**. `--name` makes the
file name stable (same name overwrites), and `diff` accepts those bare names.

**eval:** an expression (`document.title`) or statements with `return` (`const n = 2; return n * 2`); `await` works.
Results must be JSON-serializable.

## Workflows

**Check a layout.** `goto` → `screenshot` → Read the PNG. Then `inspect` / `css` the elements that look off, rather
than guessing from the picture.

**Fine-tune CSS without editing source.**
1. `screenshot --name before`
2. `css-inject '<rules>' --id fix` (repeat with the same `--id` to replace the trial rules)
3. `screenshot --name after` → `diff before after` → Read the `diffPath` image (changes in red) and check `bbox`
   covers only what you meant to change.
4. When it looks right, put the rules in the real source, `css-remove`, `reload`, and screenshot again to confirm.
   Injected CSS is dropped by navigation and reload.

**Mobile testing.** `device "iPhone 15 Pro" --reload` (or `viewport 390x844 --dpr 3 --mobile`), then `screenshot`,
`overflow` (horizontal scroll is the classic mobile bug), and `at x y` for things covered by overlays. Compare
sizes by naming shots per device. `emulate --reset` returns to the real window. Emulation is per tab.

**Something is broken.** `console --errors` first; then `at`/`inspect` the element in question.

## Error codes

`NO_SESSION` (launch first) · `BROWSER_CHOICE_REQUIRED` (ask which browser) · `SESSION_ACTIVE` · `LAUNCH_FAILED`
(`details.log` has the daemon log tail) · `NO_PAGE` · `NO_MATCH` · `AMBIGUOUS_MATCH` · `BAD_ARGS` ·
`UNKNOWN_COMMAND` · `TIMEOUT` · `BROWSER_ERROR` · `CONFIG_MISSING` / `CONFIG_INVALID` (run setup) ·
`DEPS_MISSING` (`setup --install`) · `EXE_NOT_FOUND`.

## Adding a command

The harness is meant to grow instead of accumulating one-off scripts. A command is one file in `commands/`:

```js
// commands/fonts.mjs
import { resolveElement, NTH_ARG } from '../lib/element.mjs';

export default {
  name: 'fonts',                       // lowercase kebab-case, unique
  description: 'Which font actually rendered for an element',
  args: {                              // drives parsing and `help`
    selector: { type: 'string', positional: 0, required: true },
    nth: NTH_ARG,
  },
  async run({ page, cdp, tab, state, session, args, cwd, out }) {
    const el = await resolveElement(page, args.selector, { nth: args.nth });
    return el.evaluate((n) => getComputedStyle(n).fontFamily);  // any JSON-safe value
  },
};
```

- `args` entries: `type` (`string` | `number` | `boolean`), `positional: N`, `rest: true` (joins the remaining
  positionals), `list: true` (comma-separated, repeatable), `required`, `default`, `description`.
- `run` gets: `page` (Playwright page for the target tab), `cdp` (that tab's CDP session — emulation lives here),
  `tab` (`{ id, page, cdp, emulation }`), `state` (`console` buffer, `store` for your own data), `session`
  (`tabs()`, `select(id)`, `newTab(url)`, `resetEmulation(tab)`, `browser`), `args`, `cwd` (caller's directory),
  `out.path(name, ext)` (file path in the output dir). Set `noPage: true` if it doesn't need a tab.
- Throw `new CmdError('NO_MATCH', '...')` (from `lib/errors.mjs`) for expected failures; Playwright timeouts map to
  `TIMEOUT` automatically.
- The background process loads commands at launch: `stop` + `launch` to pick up a new or changed command. A broken
  module is skipped (listed at the bottom of `help`), never fatal.
- Add a case to `tests/commands.test.mjs`.

## Tests

`npm test` in the skill folder runs unit, command and lifecycle tests against the installed browsers (headless;
`CDBG_TEST_HEADFUL=1` to watch, `CDBG_TEST_BROWSERS=chromium,brave` to choose). They use their own config, runtime
dir and profiles, so they never touch a real session.

## Notes

- Linux only. Profiles: `~/snap/<snap>/common/chromium-debug-profile` for Snap browsers (Snap can't use hidden
  dirs), `~/.local/share/chromium-debug/chromium-debug-profile-<id>` otherwise. Runtime files (socket, pid, state,
  `daemon.log`) are in `$XDG_RUNTIME_DIR/chromium-debug/`.
- The debug port is chosen by the browser (`--remote-debugging-port=0`) and bound to 127.0.0.1.
