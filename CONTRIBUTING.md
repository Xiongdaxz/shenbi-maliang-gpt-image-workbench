# Contributing

Thanks for taking the time to improve this project.

## Local Setup

```bash
bun install
bun run check
bun run build
```

Start the app:

```bash
bun run start
```

Open `http://127.0.0.1:8787` for the main app and `http://127.0.0.1:8787/config` for configuration.

## Development Notes

- Keep runtime data out of Git. Do not commit `data/`, `.env`, generated images, local binaries, logs, or database files.
- Keep config credentials in the local config console or environment variables.
- Prefer small, scoped changes that match the existing Bun, Hono, React, and Vite patterns.
- Run `bun run check` and `bun run build` before submitting changes.

## Pull Requests

Include a short description of the change, the behavior it affects, and the checks you ran.
