# Changelog

Todas las versiones notables de este proyecto se documentan aquí. El formato
sigue [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y el versionado
[SemVer](https://semver.org/lang/es/).

## [0.1.0] - 2026-11-18

### Añadido

- Plugin de OpenCode 2.x que reemplaza el catálogo del provider `commandcode`
  con el registro en vivo enriquecido por un snapshot.
- Snapshot generado desde el registro live, models.dev y la referencia de
  modelos de Command Code (104 modelos, 12 de ellos con la ruta `/messages`).
- Variantes de razonamiento, costes con tiers de contexto, límites de salida y
  fechas de publicación.
- Degradación silenciosa: sin red sirve el snapshot; sin provider configurado no
  toca el catálogo de models.dev.
