# Bat Generator — Atelier OLDA

Mini-app autonome pour générer un **Bon À Tirer (BAT)** prêt à envoyer au client par WhatsApp.
Pas de compte, pas de validation cliquable, pas de back-end : un seul écran.

## Flux

1. Saisir le **nom du client**
2. Choisir la **référence** (dropdown) et la **couleur** (pastilles)
3. Importer le **logo avant** et/ou **logo arrière** (PNG / JPG / SVG / PDF)
4. Glisser/redimensionner le logo sur le mockup
5. Cliquer **Générer le PDF** → download direct → envoyer au client par WhatsApp

Le client répond **« OK »** sur WhatsApp pour valider. Pas de clic dans le PDF.

## Dev local

```bash
npm install
npm run dev     # http://localhost:5180
```

Le dossier `public/mockups` est un symlink vers `../Mokeup fournisseur uniforme`. Si le symlink est cassé, recrée-le :

```bash
cd public && ln -sf "../../Mokeup fournisseur uniforme" mockups
```

Le manifeste `public/manifest.json` est régénéré automatiquement par `npm run dev` et `npm run build` via `scripts/build-manifest.mjs`.

## Déploiement Railway

```bash
railway up
```

Railway lit `railway.json` → build via `Dockerfile` (Node build → Caddy serve), expose sur `$PORT`.

**Avant un déploiement**, remplace le symlink `public/mockups` par une vraie copie pour que le Docker context inclue les webp :

```bash
rm public/mockups
cp -RL "../Mokeup fournisseur uniforme" public/mockups
```

(Ou ajoute ça en pre-deploy script si tu déploies souvent.)

## Stack

- Vite + React + TypeScript
- Konva (drag/resize logo)
- pdf-lib + Inter font (PDF A4 paysage)
- pdfjs-dist (ingestion logo PDF)
- Tailwind (UI, optimisée PC + Galaxy Tab A9+ 11")
