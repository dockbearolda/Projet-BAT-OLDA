# ───────────────────────────────────────────────────────────────
# STAGE 1 — Build de la SPA Vite (TypeScript → dist/)
# ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

# Deps en cache
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Sources + dossier mockups (déréférencé du symlink local en `cp -L`)
COPY tsconfig.json vite.config.ts tailwind.config.ts postcss.config.js index.html ./
COPY scripts ./scripts
COPY src ./src

# IMPORTANT : `public/` est copié séparément en suivant les symlinks
# (le symlink dev local pointe vers ../Mokeup fournisseur uniforme).
# Pour le déploiement Railway, le repo `bat-generator/` doit contenir
# un vrai dossier `public/mockups/` (non symlink) au moment du push.
COPY public ./public

# Génère manifest.json + build prod
RUN npm run build

# ───────────────────────────────────────────────────────────────
# STAGE 2 — Caddy (serve statique, gzip + brotli, headers cache)
# ───────────────────────────────────────────────────────────────
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv

EXPOSE 80
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
