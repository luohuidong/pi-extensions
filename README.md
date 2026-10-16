# Pi Coding Agent Extensions

A pnpm workspace that hosts multiple [pi](https://github.com/earendil-works/pi)
extensions. Each package under `packages/` is an independently publishable
extension with its own `package.json`, `src/`, `tests/`, and docs.

## Packages

| Package                                                             | Description                                                                             |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [`pi-show-minimax-quota`](./packages/pi-show-minimax-quota)         | Shows MiniMax Token Plan quota (5h / 7d windows) in the pi TUI status bar.              |
| [`pi-show-opencode-go-quota`](./packages/pi-show-opencode-go-quota) | Shows OpenCode Go subscription quota (5h / weekly / monthly windows) in the status bar. |
| [`pi-show-token-rate`](./packages/pi-show-token-rate)               | Shows the live output token rate (tok/s) of the active model in the status bar.         |

## Development

```bash
pnpm install                # install workspace + every package's deps
pnpm verify                 # typecheck + biome check + prettier check + tests, across all packages
pnpm format                 # biome format (ts/json) — most common
pnpm md:format              # prettier format (md) — less common
pnpm check                  # biome check (ts/json)
pnpm md:check               # prettier check (md)
pnpm -F <pkg> <script>      # run a script in one package, e.g. `pnpm -F pi-show-minimax-quota test`
```

Format/lint split:

- **Biome** handles `*.ts` and `*.json` (formatter, linter, import organizer) — see [`biome.json`](./biome.json). Invoked via `pnpm format` / `pnpm check` / `pnpm lint` / `pnpm fix`.
- **Prettier** handles `*.md` only — configured via [`.prettierrc`](./.prettierrc) and [`.prettierignore`](./.prettierignore). Invoked with an explicit `**/*.md` glob so it never touches TypeScript or JSON. Use `pnpm md:format` / `pnpm md:check`.

See [`AGENTS.md`](./AGENTS.md) for project conventions (biome workspace layout,
test expectations, the activation contract for individual extensions, etc.).

## Adding a new extension

1. `mkdir packages/<new-pkg>` and create the usual files: `package.json` (with
   a `pi.extensions` entry), `biome.json` (only `{"extends": "//"}` unless you
   need to deviate), `tsconfig.json`, `src/`, `tests/`, `README.md`, `LICENSE`.
2. `pnpm-workspace.yaml` already globs `packages/*`, so the new package is
   picked up automatically on the next `pnpm install`.
3. Add the package to the table above.

## Releasing

Releases are managed by pnpm itself — no separate release tool is installed:

```bash
pnpm change        # record a change intent (writes .changeset/<name>.md, commit it with the change)
pnpm change status # preview the release plan the pending intents produce
pnpm version -r    # apply the plan: bump versions, write changelogs (--dry-run to preview)
pnpm publish -r    # publish every version that is not on the registry yet
```

Intent files use the [changesets](https://github.com/changesets/changesets)
format, but the Changesets CLI is not used. Release behavior is configured under
`versioning:` in [`pnpm-workspace.yaml`](./pnpm-workspace.yaml); the docs live at
<https://pnpm.io/versioning>. `pnpm version -r` neither commits nor tags (one run
can bump several packages to different versions), so commit the result yourself
before publishing.

## License

MIT
