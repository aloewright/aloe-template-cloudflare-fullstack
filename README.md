# Cloudflare Fullstack Template

Run the app with `doppler run -- npm install` and `doppler run -- npm run dev`.

The Vite client proxies `/api` to the local Worker on `127.0.0.1:8787`.
The Worker exposes:

- `GET /api/health`
- `GET /api/me` returning `null` when signed out

The D1 binding and Better Auth config are scaffolded for Cloudflare deployment.
The `template.toml` file is intentionally a stub until the PDX-63 manifest schema is defined.
