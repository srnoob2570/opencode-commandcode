# Convenciones de commit

## Formato

- Conventional Commits: `type(scope): resumen en imperativo`, asunto ≤ 72 caracteres.
- Tipos usados: `feat`, `fix`, `docs`, `test`, `chore`, `ci`, `refactor`.
- Scopes previstos: `catalog` (generador y snapshot), `plugin` (runtime), `release`.
  Sin scope cuando el cambio cruza todo el repo o es el commit inicial.

## Changelog

- `CHANGELOG.md` sigue Keep a Changelog y está en español, igual que los README.
- Las entradas van bajo `## [Unreleased]` durante el desarrollo; al cortar una
  versión se renombra la sección con su fecha.
- El commit que corta la release no añade un bullet nuevo: la sección de versión
  ya documenta el contenido.
- Cambios internos (tests, CI, refactors) no generan entrada.

## Notas

- Los textos de usuario (README, CHANGELOG, mensajes de error) van en español;
  el README principal está en inglés y `README.es.md` es su espejo.
- El snapshot se regenera con `bun run build:catalog` y se commitea junto al
  generador que lo produjo.
