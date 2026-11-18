# opencode-commandcode

[English](README.md) · Español

OpenCode arma su catálogo de modelos desde [models.dev](https://models.dev), que
va por detrás del registro de Command Code: hay modelos nuevos (Ultrafast, por
ejemplo) que ya funcionan por API antes de aparecer en el selector, y los
límites de salida, esfuerzos de razonamiento y precios llegan tarde o
incompletos.

Este plugin toma el control del set de modelos del provider `commandcode` y lo
llena con el registro en vivo más un snapshot empaquetado de esos metadatos.

## Instalación

1. Configura el provider de Command Code en OpenCode, con
   `opencode auth login` o exportando `CMD_API_KEY`.
2. Añade el plugin:

   ```sh
   opencode plugin add @srnoob2570/opencode-commandcode
   ```

3. Elige un modelo. La lista incluye ya el catálogo vivo completo, por ejemplo
   `deepseek/deepseek-v4.1-flash-ultrafast`.

No hace falta reiniciar después de registrar el plugin.

## Qué cambia

- **Los modelos nuevos aparecen el primer día.** El registro en vivo decide qué
  modelos existen, así que todo lo que Command Code sirve es seleccionable.
- **Límites y esfuerzos completos.** El contexto y el límite de salida salen de
  la entrada live y del snapshot; los esfuerzos de razonamiento se convierten en
  variantes del modelo (`off`, `low`, `high`, `max`, etc.).
- **Precios reales.** Entrada, salida, lectura/escritura de caché y tiers por
  contexto se mapean al modelo de costes de OpenCode.
- **Claude por la ruta correcta.** Los modelos Claude solo responden en
  `/messages`, así que llevan el paquete runtime de Anthropic por modelo; el
  resto sigue en el paquete OpenAI-compatible.

## Cómo funciona

Al arrancar, el plugin llama al endpoint público
`GET /provider/v1/models` (sin credenciales) y mezcla el resultado con
`plugin/snapshot.ts`:

- El registro en vivo define el set: los modelos retirados desaparecen y los ids
  desconocidos se añaden con valores conservadores (32k de salida, solo texto,
  sin precio).
- El snapshot solo enriquece ids conocidos: límite de salida, visión, esfuerzos,
  precios y fecha de publicación.
- Si la petición falla, el snapshot sirve el catálogo completo.
- Si el provider no está configurado, el transform ni se registra y el catálogo
  de models.dev queda intacto.

El snapshot se genera desde tres fuentes: el registro en vivo, models.dev y la
referencia de modelos de Command Code. Regénéralo con `bun run build:catalog`.

## Limitaciones

- Entre releases el snapshot envejece. Los modelos nuevos en vivo siguen
  apareciendo, pero sin precio ni límite de salida hasta el siguiente build.
- El snapshot es metadata, no una garantía: los planes limitan algunos modelos y
  el precio de Command Code es la fuente de verdad.
- Solo se llama al endpoint público de modelos. Ningún prompt, clave ni dato de
  cuenta sale de la máquina.

Sin relación con Command Code.

## Desarrollo

```sh
bun install
bun test
bun run typecheck
bun run build:catalog   # reescribe plugin/snapshot.ts
```

MIT.
