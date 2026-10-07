# SmartLand web app

React 19 + Vite + Tailwind CSS 4. See the root `README.md` to run the whole stack.

```bash
npm install
npm run dev     # http://localhost:3001, proxies /api to http://localhost:3000
npm run build   # type-check and build to dist/
npm run lint
```

Set `SMARTLAND_API` to point the dev proxy at another backend.

## Layout

- `src/styles/tokens.css`: design tokens from `/DESIGN.md`, with light and dark roles
- `src/styles/index.css`: Tailwind theme mapped to the tokens (defaults cleared)
- `src/pages/`: Home, Check a location, Report, Saved reports
- `src/components/`: shared UI (nav, buttons, fields, states, grade badge)
- `src/lib/`: API client, saved-report store, formatting, theme, motion

Saved reports live in the browser's local storage, so they stay on one device.
