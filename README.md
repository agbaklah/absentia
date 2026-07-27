# Absentia

Leave & Absence Management.

## Development

Requires [Bun](https://bun.sh).

```sh
bun install
bun run dev
```

The dev server runs at http://localhost:8080.

### Scripts

- `bun run dev` — start the dev server
- `bun run build` — production build
- `bun run preview` — preview the production build
- `bun run lint` — run ESLint
- `bun run format` — format with Prettier

## Environment

Copy the required Supabase variables into `.env`:

```sh
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

## Built with

- TanStack Start
- React
- TypeScript
- Tailwind CSS
- Supabase
