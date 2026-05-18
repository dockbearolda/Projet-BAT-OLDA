# Mokeup fournisseur optimisé

Réorganisation propre du dossier `Mokeup fournisseur/` pour intégration au site
(tri par référence, couleur, vue avant/arrière/manche).

## Arborescence

```
Mokeup fournisseur optimisé/
├── BEBE/
│   └── B-001_K831/
│       └── black/
│           ├── B-001_K831_front.png
│           └── B-001_K831_back.png
├── ENFANT/
│   └── E-001_NS307/
│       └── black/
│           ├── E-001_NS307_front.png
│           ├── E-001_NS307_back.png
│           ├── E-001_NS307_sleeve.png
│           ├── E-001_NS307_front_lifestyle.png
│           └── E-001_NS307_back_lifestyle.png
├── FEMME/
└── HOMME/
```

Le format est :

```
CATEGORIE/<REF_INTERNE>_<REF_FOURNISSEUR>/<couleur>/<REF_INTERNE>_<REF_FOURNISSEUR>_<vue>.<ext>
```

## Conventions

| Élément       | Format                                                           |
|---------------|------------------------------------------------------------------|
| Catégories    | `BEBE`, `ENFANT`, `FEMME`, `HOMME` (sans accent, URL-safe)       |
| Référence     | `<INTERNE>_<FOURNISSEUR>` ex. `H-001_NS300`, `B-002_K837`        |
| Couleur       | anglais lowercase, underscore : `dark_khaki`, `navy`, `wet_sand` |
| Extensions    | `.png` `.jpg` `.avif` `.webp` (préservées de la source)          |

### Vues disponibles (suffixe `_<vue>`)

Les valeurs sont normalisées depuis les conventions Stanley/Stella, Kariban, B&C, etc.

| Vue                  | Source(s) d'origine                              | Description                  |
|----------------------|--------------------------------------------------|------------------------------|
| `front`              | `PS_REF_*`, fichiers `AV` / `av`, `_front`       | Avant — packshot principal   |
| `back`               | `PS_REF-B_*`, fichiers `AR` / `ar`, `_back`      | Arrière — packshot           |
| `sleeve`             | `PS_REF-S_*`                                     | Vue de côté / manche         |
| `front_lifestyle`    | `PS_REF-2_*`                                     | Avant porté (lifestyle)      |
| `back_lifestyle`     | `PS_REF-B-2_*`                                   | Arrière porté                |
| `sleeve_lifestyle`   | `PS_REF-S-2_*`                                   | Côté porté                   |
| `front_alt`          | `PS_REF-3_*`                                     | Avant alternatif             |
| `back_alt`           | `PS_REF-B-3_*`                                   | Arrière alternatif           |
| `front_sleeve`       | `PS_REF-FS_*`                                    | Cas isolé (CGTU01T)          |

## Statistiques

- **Fichiers traités** : 1527 / 1527 (100%)
- **Références** : 31
- **Couleurs uniques** : 175
- **Catégories** : 4 (BEBE 29, ENFANT 175, FEMME 183, HOMME 1140)
- **Non mappés** : 0
- **Collisions** : 1 (voir `_collisions.csv`)

### Détail par vue

| Vue                | Nombre |
|--------------------|--------|
| front              | 412    |
| back               | 406    |
| sleeve             | 277    |
| front_lifestyle    | 172    |
| back_lifestyle     | 166    |
| sleeve_lifestyle   | 61     |
| back_alt           | 17     |
| front_alt          | 15     |
| front_sleeve       | 1      |

## Fichiers de suivi

- **`_manifest.csv`** — chaque ligne = un fichier optimisé. Colonnes :
  `category, ref_internal, ref_supplier, ref_label, color, view, ext, src, dst`.
  Idéal pour seeder une base de données ou builder un endpoint API.
- **`_unmapped.csv`** — fichiers que le script n'a pas su classer (vide ici).
- **`_collisions.csv`** — fichiers source différents qui voulaient écrire au
  même endroit. Le second a reçu un suffixe `_2`.

## Points d'attention pour l'intégration

1. **K3028IC** n'avait pas de code interne dans la source. Code `H-020`
   auto-attribué (le seul manquant dans la séquence H-001 → H-021).
   ➜ À valider de ton côté ; si tu veux un autre code, il suffit de modifier
   `REF_MAP` dans `reorganize_mokeup.py` et relancer.

2. **LYCRA Paragon** (`L-001_LYCRA-PARAGON`) — référence atypique : un seul
   sous-modèle "Paragon" dans la source. Si d'autres modèles LYCRA arrivent
   plus tard, il faudra étendre la convention (ex. `L-001-PARAGON`,
   `L-002-FLEX`, etc.).

3. **Collision PA438** : `PS_PA438_BLACK.png.avif` apparaît à la fois dans
   `NOIR/` et `SPORT NAVY/` côté source — probablement un fichier mal classé
   chez le fournisseur. Le second a été renommé `H-016_PA438_front_2.avif`.
   À nettoyer manuellement si besoin.

4. **Extensions doubles** : les fichiers `.png.avif` et `.jpg.avif` ont été
   normalisés vers `.avif` (l'extension réelle du contenu).

5. **Couleurs bicolores** : `Vintage Blue : Blanc` (BY190) → `vintage_blue_white`.

## Reconstruire la copie

```bash
python3 reorganize_mokeup.py --dry-run   # simulation, génère manifest dans /tmp
python3 reorganize_mokeup.py             # copie réelle
```

Le script est idempotent : `shutil.copy2` n'écrase rien si la cible existe déjà.
