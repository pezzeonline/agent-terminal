<div align="center">
  <img src="./docs/assets/glass-terminal-transparent.png" width="128" alt="Agent Terminal" />

  # Agent Terminal

  **A terminal workspace built around AI coding agents.**

  [![Status](https://img.shields.io/badge/status-pre--alpha-orange)](#status)
  [![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)](#tested-on)
  [![Upstream](https://img.shields.io/badge/fork_of-DaniAkash%2Fagent--terminal-blue?logo=github)](https://github.com/DaniAkash/agent-terminal)
</div>

> [!NOTE]
> **This is a community fork** of [**DaniAkash/agent-terminal**](https://github.com/DaniAkash/agent-terminal),
> maintained by [Alessandro Benedetti](https://github.com/pezzeonline). It tracks upstream and adds a
> few features (see [Fork additions](#fork-additions)) while those changes make their way back into the
> original project. All credit for the original work goes to [Dani Akash](https://github.com/DaniAkash).
> For the canonical project and signed release downloads, see the [upstream repository](https://github.com/DaniAkash/agent-terminal).

<p align="center">
  <a href="https://github.com/DaniAkash/agent-terminal/releases/latest"><img src="https://img.shields.io/badge/Signed_downloads-Upstream%20releases-000?style=for-the-badge&logo=apple&logoColor=white" alt="Signed downloads from upstream"></a>
  &nbsp;
  <a href="#build-from-source"><img src="https://img.shields.io/badge/This_fork-Build%20from%20source-0071C5?style=for-the-badge&logo=rust&logoColor=white" alt="Build this fork from source"></a>
</p>

<p align="center"><sub>This fork does not yet publish pre-built binaries. Grab a signed build of the original from
<a href="https://github.com/DaniAkash/agent-terminal/releases/latest">upstream releases</a>, or
<a href="#build-from-source">build this fork from source</a> to get the fork-only features.</sub></p>

<p align="center">
  <em>or install via Homebrew:</em><br/>
  <code>brew tap daniakash/tap && brew install --cask agent-terminal</code>
</p>

<p align="center">
  <a href="https://www.producthunt.com/products/agent-terminal?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-agent-terminal" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1136595&theme=light&t=1777623264721" alt="Agent terminal - One terminal. Every agent. Total clarity. | Product Hunt" width="250" height="54" /></a>
</p>

---

## Status

> 🧪 **Pre-alpha.** Heavily tested on **macOS + Zsh** — that's the daily-driver setup. Other shells and platforms may work but aren't part of the test matrix yet. Things will change without warning.

---

## Fork additions

This fork adds the following on top of upstream. Both are also proposed back to the original project as pull requests:

### ⚙️ Settings window
A tabbed **Settings** window with a **Font** tab — choose the terminal's **font family** and **font size** from a proper UI instead of editing config. Your choice is persisted and applied live to the active terminal.

### ⌨️ Font-zoom fix for non-US keyboards
The `Cmd +` / `Cmd -` / `Cmd =` zoom shortcuts previously matched the **physical key position**, so they didn't fire on many non-US keyboard layouts (where `=`/`-`/`+` sit elsewhere). Zoom is now matched by the **produced character**, so it works regardless of layout.

## Why this exists

If you live in a terminal alongside [Claude Code](https://claude.ai/code), [Codex](https://github.com/openai/codex), or other AI coding agents, you've probably noticed normal terminals weren't designed for the way you work now: **multiple agents, multiple projects, multiple long-lived sessions, all needing context at a glance**.

Agent Terminal is a terminal that knows the difference between a shell and an agent. It groups your tabs by project, recognises when an agent is running, and surfaces what's happening — the model in use, what's listening on which port, the git branch, your cwd — without you switching windows or running `ps`.

![Agent Terminal screenshot](./docs/assets/screenshot.png)

---

## What you actually get

### Projects and tabs that survive
Group tabs under projects (`my-app`, `notes`, `infra`). Switch projects without losing your place — every tab remembers its working directory and reopens there.

### Live status bar
Always-on context for the focused tab — refreshed every couple of seconds, never gets stale:

- Process name, PID, elapsed time, memory
- Listening TCP ports (so you know when your dev server is up)
- Git branch, dirty indicator, ahead/behind remote
- Working directory (hover for full path)

### Theme-aware workspace
 Switch between light, dark, and system themes from the status bar. The chosen theme now applies across the whole application and the active terminal, so agent sessions stay readable in both light and dark modes.

### Supported agents

| Agent | Status |
|---|---|
| [Claude Code](https://claude.ai/code) | ✅ Supported |
| [Codex CLI](https://github.com/openai/codex) | ✅ Supported |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | 🔜 Planned |
| [Cursor](https://www.cursor.com) | 🔜 Planned |
| [Open Code](https://github.com/sst/opencode) | 🔜 Planned |

Want support for another agent? [Open an issue](https://github.com/DaniAkash/agent-terminal/issues/new) or [tell me on X](https://x.com/dani_akash_).

### Find your way back
`Cmd+P` opens a switcher for your recently used tabs — type a few letters, hit Enter, you're there.

### Keyboard shortcuts
- `Ctrl+T` — new tab in the active project
- `Ctrl+W` — close the active tab
- `Ctrl+Tab` / `Ctrl+Shift+Tab` — cycle tabs
- `Ctrl+1` … `Ctrl+9` — jump to project N
- `Cmd+P` — open the recent-tabs quick-switcher

---

## Tested on

| Platform | Status |
|---|---|
| macOS 13+ (Apple Silicon / Intel) | ✅ Daily driver |
| Zsh | ✅ Daily driver |
| Bash | ⚠️ Should work, lightly tested |
| Linux | 🚧 Untested — contributors wanted |
| Windows | 🚧 Untested — contributors wanted |

## 🙏 Looking for contributors

The most useful thing you can do right now is **help bring Agent Terminal to Windows and Linux**. The Tauri + portable-pty stack underneath supports both, but I don't run those platforms day-to-day, so the integration work isn't happening on its own.

Specifically helpful:

- **Linux testers** — try a dev build, file what's broken (rendering, shell integration, keyboard shortcuts, anything).
- **Windows testers + developers** — Windows needs ConPTY-side adjustments and a separate shell-integration path; if you're up for Tauri/Rust work, this is the highest-leverage area to contribute.
- **Other agent integrations** — adding Gemini CLI, Cursor, Open Code, etc. is a focused PR (see [CONTRIBUTING.md](./CONTRIBUTING.md) for the MOD system guide).
- **Bug reports + feature ideas** — open an issue, even rough ones.

If you're interested, [open an issue](https://github.com/DaniAkash/agent-terminal/issues/new) or [reach out on X](https://x.com/dani_akash_) — happy to pair / sync on direction.

---

## Roadmap

Already shipped:
- ✅ Project-scoped workspaces with persistent tabs
- ✅ Live status bar (process, git, cwd, ports, model)
- ✅ Claude Code + Codex detection and agent badges
- ✅ Agent turn detection (idle / in-progress / awaiting / done)
- ✅ Keyboard shortcuts
- ✅ Universal macOS binary (Apple Silicon + Intel)
- ✅ Theme toggle with light / dark / system support

Coming next:
- 🚧 More agent integrations (Gemini CLI, Cursor, Open Code)
- 🚧 Linux support
- 🚧 Windows support
- 🚧 macOS App Store distribution

---

## Build from source

This fork ships no pre-built binaries yet, so build it yourself:

```bash
git clone https://github.com/pezzeonline/agent-terminal.git
cd agent-terminal
bun install
bun run tauri:build   # produces a .dmg under src-tauri/target/release/bundle/
```

The build is **unsigned**, so on first launch macOS Gatekeeper will warn you — right-click the app and choose **Open** to run it. For a signed + notarized build, use the [upstream releases](https://github.com/DaniAkash/agent-terminal/releases/latest).

For a live dev instance, `bun run tauri:dev`. See [CONTRIBUTING.md](./CONTRIBUTING.md) for full setup details, and [docs/RELEASING.md](./docs/RELEASING.md) for signing keys, Apple credentials, and cutting a signed release.

---

## Contributing

For development setup, project structure, code conventions, and the MOD-system guide for adding new agents:

→ **[CONTRIBUTING.md](./CONTRIBUTING.md)**

This is a fork — for changes you want in the canonical project, please also consider opening a PR against [upstream](https://github.com/DaniAkash/agent-terminal). Issues specific to this fork's additions go to [pezzeonline/agent-terminal/issues](https://github.com/pezzeonline/agent-terminal/issues).

---

## License

MIT — see [LICENSE](./LICENSE).

Copyright © 2026 [Dani Akash](https://github.com/DaniAkash) (original work) and © 2026 [Alessandro Benedetti](https://github.com/pezzeonline) (fork contributions). This fork retains the original copyright notice as required by the MIT License; if you build on it, please do the same.
