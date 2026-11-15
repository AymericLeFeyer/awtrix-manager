# AWTRIX Manager

Interface web pour gérer plusieurs [AWTRIX](https://blueforcer.github.io/awtrix3/) via MQTT. Successeur de
[awtrix-creator-counter](https://github.com/AymericLeFeyer/awtrix-creator-counter).

```
providers (Creator Studio, Home Assistant, API JSON…) ─► widgets ─► MQTT ─► afficheurs AWTRIX
```

- **Appareils** : chaque AWTRIX est identifié par son préfixe MQTT. On voit son état (stats MQTT) et on le pilote
  (on/off, app suivante/précédente, luminosité, notification, redémarrage).
- **Providers** : une source de données configurée une fois. Fournis : *Aylabs Creator Studio* (`/api/export`),
  *Home Assistant* (entités, jeton longue durée), *API JSON (HTTP)* générique. Pour en ajouter : un module dans
  `src/providers/` (`sources(cfg, q)` + `read(cfg, source)`) et une ligne dans `src/providers/index.js`.
- **Widgets** : une valeur d'un provider + gabarit (`{value}{unit}`, décimales, format compact `12,4k`) + icône + couleur,
  puis une case à cocher par appareil dans la matrice. Chaque widget est publié sur `<préfixe>/custom/<nom>` et
  rafraîchi à son intervalle ; décocher/supprimer retire l'app de l'appareil.
- **Icônes** : comme l'interface AWTRIX, on utilise les ID de la galerie LaMetric. « Installer » télécharge l'icône
  (convertie en GIF) dans `/ICONS` de l'appareil ; on peut aussi choisir parmi les icônes déjà présentes sur l'appareil.
- Les apps custom vivent en RAM côté AWTRIX : elles sont renvoyées automatiquement après un redémarrage de l'appareil
  ou une reconnexion au broker.

## Lancer

```bash
npm ci && npm start          # http://localhost:4444
```

Docker : `docker compose up -d` (image `ghcr.io/aymericlefeyer/awtrix-manager`, config dans le volume `/app/data`).
Variables optionnelles pour pré-remplir le broker : `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `PORT`, `DATA_DIR`.

Aucune authentification : à garder sur le réseau local.

## Côté AWTRIX

Dans l'interface de chaque AWTRIX → *MQTT* : renseigner le broker et un **préfixe unique** (ex. `awtrix_salon`),
à reporter dans l'onglet Appareils. L'IP (pour les icônes) est lue dans les stats MQTT.
