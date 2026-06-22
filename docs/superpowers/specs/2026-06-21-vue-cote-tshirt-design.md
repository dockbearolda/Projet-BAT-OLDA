# Vue de côté (manche) pour le BAT — Design

**Date** : 2026-06-21
**Auteur** : Claude (pour OLDA)

## Problème

Le BAT affiche aujourd'hui deux vues par t-shirt : **face** et **dos**. On veut
pouvoir ajouter, **à la demande**, une **troisième vue « Côté »** (profil/manche),
avec un logo positionnable dessus (marquage manche), et l'inclure dans le PDF.

Contrainte clé : les t-shirts sont des **mockups image fixes** (pas de 3D), donc
on ne peut afficher un côté que si une image existe. Heureusement les côtés
sont **génériques par type de manche** : tous les côtés manche courte se
ressemblent (idem manche longue) ; seule la **couleur** distingue deux côtés.

## État des lieux (données réelles)

- Stack : React 18 + Vite + Konva (canvas 2D) + pdf-lib. Pas de 3D.
- Manifest généré par `scripts/build-manifest.mjs` à partir de
  `public/mockups/_manifest.csv`.
- Le CSV contient **déjà 277 lignes `view=sleeve`** ; le script les parse mais
  ne les sérialise pas (il ne sort que `front`/`back`).
- Couverture côté sur 411 variants couleur :
  - côté **propre** déjà présent : 277 (67 %)
  - couleur **exacte** dispo ailleurs : 283 (69 %)
  - couleur quasi identique (Δhex ≤ 15) : 366 (89 %)
- Une image `sleeve` = profil studio propre du t-shirt entier, fond blanc,
  manche face au spectateur.

## Comportement cible

1. **Vue « Côté » optionnelle.** Un bouton **« + Ajouter la vue de côté »**.
   Tant qu'on ne clique pas, le BAT reste à face/dos. Une fois ajoutée, on peut
   la retirer.
2. **Logo sur la manche.** Même interaction que face/dos : drag, resize,
   recoloration monochrome. Position/échelle propres à la vue côté.
3. **Image de côté choisie automatiquement**, par ordre de fidélité :
   1. **côté propre** à la réf+couleur s'il existe (67 %) — fidélité parfaite ;
   2. sinon **côté emprunté** : même `sleeveType`, couleur la plus proche
      (Δhex ≤ seuil) parmi la bibliothèque des côtés existants ;
   3. sinon **gabarit recoloré** : un côté gris neutre du bon `sleeveType`,
      teinté à la **couleur exacte** du t-shirt (gradient map luminance →
      couleur). Garantit 100 % de couverture, toujours à la bonne couleur.
4. **PDF** : le BAT inclut la vue côté **seulement si activée**. Mise en page
   adaptée à 1, 2 ou 3 visuels.

## Architecture

### Données (`src/types.ts`)
- `Face` passe de `"front" | "back"` à `"front" | "back" | "side"`.
- `FaceLabels` : ajouter `side: "Côté"`.
- `ColorVariant` : ajouter `sleeve: string | null` (chemin du côté propre).
- `RefEntry` : ajouter `sleeveType: "short" | "long"`.
- Nouvelle table dans le manifest : `sideLibrary` =
  `Array<{ sleeveType, slug, hex, url }>` — index de tous les côtés existants,
  pour la résolution « emprunt par couleur ».

### Manifest (`scripts/build-manifest.mjs`)
- Sérialiser `sleeve: views.sleeve ?? null` sur chaque couleur.
- Échantillonner le hex du côté (réutilise `sampleHex`) pour `sideLibrary`.
- Classer chaque réf en `sleeveType` (table de classification en tête de
  script ; défaut `"short"`, override explicite pour les manches longues
  identifiées visuellement).
- Construire et écrire `sideLibrary`.

### Résolution du côté (`src/sideView.ts`, nouveau)
- `resolveSide(ref, color, sideLibrary): { kind: "own"|"borrowed"|"recolor", url? , hex? , sleeveType }`
  - `own` si `color.sleeve` existe ;
  - sinon plus proche hex dans `sideLibrary` filtré par `sleeveType`, si
    Δ ≤ seuil → `borrowed` ;
  - sinon `recolor` (renvoie `sleeveType` + `hex` cible).
- Fonction pure, testable unitairement.

### Recoloration gabarit (`src/sideRecolor.ts`, nouveau)
- Un gabarit neutre par `sleeveType` (`/templates/side-short.webp`,
  `side-long.webp`), généré depuis un côté clair existant (désaturé).
- `recolorSide(templateImg, hex): canvas/dataURL` — gradient map
  (noir → couleur → blanc selon la luminance) pour préserver ombres/reflets.

### UI (`src/App.tsx`, `src/canvas/CanvasStage.tsx`)
- État `side: FaceState` + flag `sideEnabled: boolean`.
- Bouton d'ajout/retrait de la vue côté.
- 3ᵉ `CanvasStage` rendu uniquement si `sideEnabled`. La source d'image vient
  de `resolveSide` (+ `recolorSide` si `kind==="recolor"`).
- Grille responsive : 1/2/3 colonnes selon le nombre de vues.

### PDF (`src/pdf/buildPdf.ts`, `src/compose.ts`)
- `compose` réutilisé tel quel pour la vue côté.
- `buildBatPdf` accepte 1 à 3 visuels et calcule la largeur/disposition.

## Contraintes de layout (dures)

- **Côté gauche** : on affiche le profil gauche du t-shirt. Si l'image source
  montre le côté droit, on la **retourne horizontalement** (flip) pour obtenir
  le côté gauche. Vérifié visuellement à l'implémentation.
- **Bulles (cartes) identiques** : la carte de la vue côté doit faire
  **exactement la même taille** que les cartes Face/Dos. L'ajout de la 3ᵉ vue ne
  doit **ni redimensionner ni déformer** la page ni les deux cartes existantes.
- **T-shirts même hauteur** : le visuel t-shirt rendu dans la vue côté a la
  **même hauteur** que dans Face/Dos (échelle cohérente entre les 3 vues), à
  l'écran **et** dans le PDF.

## Hors périmètre (YAGNI)
- Pas de vues lifestyle/alt (présentes dans le CSV mais non utilisées).
- Pas de recoloration des faces/dos (déjà des images réelles par couleur).
- Pas de gestion multi-page PDF.

## Risques / arbitrages
- **Recolor gabarit** : fidélité photo légèrement moindre sur ombres pour les
  ~11 % de couleurs rares — accepté (couleur exacte prioritaire pour un BAT).
- **Classification sleeveType** : faite à la main (visuel) ; faible volume
  (31 réfs), revérifiable.
- **Emprunt de silhouette** : un côté emprunté montre la silhouette d'une autre
  réf — accepté car les côtés se ressemblent par type de manche.
