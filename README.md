# Pi Coding Agent Extensions

A pnpm workspace that hosts multiple [pi](https://github.com/earendil-works/pi)
extensions. Each package under `packages/` is an independently publishable
extension with its own `package.json`, `src/`, `tests/`, and docs.

## Packages

| Package                                                     | Description                                                                |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| [`pi-show-minimax-quota`](./packages/pi-show-minimax-quota) | Shows MiniMax Token Plan quota (5h / 7d windows) in the pi TUI status bar. |

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
   need to deviate), `tsconfig.json`, `src/`, `tests/`, `README.md`, `LICENSE.md`.
2. `pnpm-workspace.yaml` already globs `packages/*`, so the new package is
   picked up automatically on the next `pnpm install`.
3. Add the package to the table above.

## License

MIT
