# Módulos

Cada módulo vive en `modules/<id>/` y se registra en `modules/index.js`.

Hay dos tipos:

- **CSS**: `background.js` inyecta `styles` con `chrome.scripting`.
- **Contenido**: `content.js` monta `modules/<id>/content.js` en la página.

## Definición

```js
export const definition = {
  id: "ejemplo",
  name: "Ejemplo",
  description: "Texto breve para el popup.",
  matches: ["/*"],
  defaultEnabled: false,
  hasContent: true,
  requiresSession: false,
  defaultSettings: {},
};
```

Campos:

- `id`: identificador único, sin espacios. Define la carpeta y las claves de
  storage.
- `name`: nombre visible en el popup.
- `description`: texto breve para la interfaz.
- `matches`: rutas relativas al target activo, por ejemplo `/*` o `/live/*`.
  También acepta URLs completas.
- `defaultEnabled`: estado inicial.
- `hasContent`: si es `false`, el content script no intenta cargar
  `modules/<id>/content.js`. Úsalo en módulos solo CSS.
- `requiresSession`: si es `true`, el módulo solo se considera activo cuando la
  tarjeta **Tu directo** muestra sesión iniciada.
- `styles`: solo módulos CSS. Lista de archivos CSS dentro de la carpeta del
  módulo.
- `defaultSettings`: ajustes iniciales serializables a JSON. Opcional.
- `legacyState`: solo para migrar la clave antigua `andypsxLiveEnabled`.

## Registro

```js
// modules/index.js
import { definition as vistaLimpia } from "./vista-limpia/index.js";
import { definition as raffles } from "./raffles/index.js";

export const modules = [vistaLimpia, raffles];
```

## Módulo CSS

`hasContent: false`. El background usa `styles`:

```js
export const definition = {
  id: "ejemplo",
  name: "Ejemplo",
  description: "Ajuste visual.",
  matches: ["/*"],
  defaultEnabled: false,
  hasContent: false,
  styles: ["ejemplo.css"],
};
```

El orden de `modules` define el orden de inserción del CSS. Si dos módulos
tienen reglas con la misma especificidad, el último gana.

## Módulo de contenido

`hasContent: true`. Crea `content.js`:

```js
export function init(ctx) {
  ctx.log("activo");

  return () => {
    // limpieza opcional
  };
}

export function destroy() {
  // observers, timers, listeners y atributos
}
```

`init(ctx)` recibe:

- `ctx.id`: id del módulo.
- `ctx.bus`: eventos locales.
- `ctx.storage`: helpers de `chrome.storage`.
- `ctx.getSettings()`: lee los ajustes actuales.
- `ctx.log(...)`: log con prefijo del módulo.

El registro ejecuta la limpieza devuelta por `init` y después `destroy()`.

## Bus

```js
const off = ctx.bus.on("raffles:clicked", (data) => {
  ctx.log("Clic:", data.title);
});

ctx.bus.emit("raffles:snapshot", { count: 1 });
off();
```

Usa nombres con formato `modulo:accion`. Los datos deben ser serializables a
JSON. El bus es local al content script; no cruza al background.

## Storage

```json
{
  "modules": {
    "ejemplo": {
      "enabled": false,
      "settings": {}
    }
  }
}
```

`getModuleStates` rellena los valores que falten. Para escribir usa
`setModuleEnabled` de `core/storage.js`.

## Sesión

`core/session.js` detecta si la tarjeta `section[aria-label="Tu cuenta del
directo"]` muestra `Desconectar` / `Tus Mochuelos` (sesión iniciada),
`Inicia sesión` (sin sesión) o `Reconectar Live` (live desconectado). El otro
login de la cabecera se ignora.

El estado se guarda en `chrome.storage.local`, clave `session`:

```json
{
  "known": true,
  "loggedIn": false,
  "origin": "https://andypsx.com",
  "reason": "login-action",
  "updatedAt": 1760000000000
}
```

Si un módulo tiene `requiresSession: true`:

- el background no aplica su CSS sin sesión;
- el content script no lo monta sin sesión;
- el popup deshabilita su toggle y muestra “Inicia sesión para activar.”;
- la preferencia guardada se conserva y se reaplica al iniciar sesión.

## Archivos adicionales

Si un módulo de contenido importa helpers propios, añádelos a
`web_accessible_resources` en `manifest.json`. Los archivos que solo usa el
background no necesitan esa lista.

## Cambiar la URL objetivo

Edita solo `core/config.js`:

```js
production: {
  url: "https://TU-DOMINIO/RUTA",
},
```

Después cambia `ACTIVE_TARGET` a `"production"` y recarga la extensión y la
página.
