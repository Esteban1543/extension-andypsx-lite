# AndyPSX Live · Vista Limpia — Extensión de Chrome/Firefox

Extensión de navegador que reordena **solo en tu navegador** la página
`https://andypsx.com/live`, sin modificar la web real para nadie más.

Tiene dos módulos independientes:

- **Vista limpia**: solo CSS. Reordena y oculta bloques del directo.
- **Raffles**: content script aislado. Detecta raffles sin contraseña y pulsa
  `Participar` con esperas aleatorias y clics humanos.

> El CSS se inyecta con `chrome.scripting`. El módulo de raffles usa un
> `content_script` de Chrome en el mundo aislado. No modifica el JavaScript de
> la página.

---

## 1. Qué hace

### Vista limpia

- **Reordena** la barra lateral en 5 columnas fijas:

```text
┌────────┬───────────────┬───────────────┬──────────┬─────────┐
│        │               │               │ APUESTAS │         │
│ RAFLES │ CAJAS VIEWER  │ CAJAS SUBS    │ DIRECTO  │ GUESSES │
│   ↓    │               │               │          │         │
└────────┴───────────────┴───────────────┴──────────┴─────────┘
```

- **Espacio pre-asignado**: si una tarjeta no existe, su hueco se dibuja
  punteado (`RAFLES` / `GUESSES`).
- **Oculta**: cabecera, título, pie, reproductor del directo, Bonus Hunt,
  Actividad del directo, Últimos ganadores, Soporte, "Tu directo" y el popup
  "Instala PSX Rewards en Chrome".
- **Cajas** partida en VIEWER (No Subs) / SUBS.
- **Ganadores del sorteo**: la lista flota encima y se invierte para que los
  últimos queden arriba.
- **Alturas independientes**: una tarjeta alta no estira a las vecinas.
- **Responsive**: 5 columnas → 2 por fila → 1 por fila.
- **Solo con sesión iniciada**: si la tarjeta “Tu directo” muestra
  `Inicia sesión`, Vista limpia queda desactivada y el CSS no se aplica.
- **Live desconectado**: si muestra `Reconectar Live` o “sesión caducada”,
  también queda desactivada hasta reconectar.

### Sesión

- Detecta la tarjeta `section[aria-label="Tu cuenta del directo"]`.
- Sesión iniciada: `Desconectar` o `Tus Mochuelos`.
- Sin sesión: `Inicia sesión` / `Iniciar sesión`.
- Live desconectado: `Reconectar Live` o “Tu sesión del directo ha caducado”.
- El otro botón de login de la cabecera se ignora.
- Mientras carga la sesión, Vista limpia queda apagada.
- Al cerrar sesión se quita el CSS. Al volver a iniciar sesión, se reaplica si
  el usuario la tenía activada.

### Raffles

- Detecta todos los `section[aria-label^="Raffle:"]`.
- **Omite los raffles con contraseña**.
- Omite los que ya participaste, no tienen botón o lo tienen deshabilitado.
- Espera **5–10 s** antes del primer clic de cada tanda.
- Espera **2–5 s** antes de cada clic siguiente de la misma tanda.
- Si la cola queda vacía y aparece otro raffle, vuelve a contar como primera
  tanda.
- Hace clic con secuencia de ratón simulada: mover, pasar por encima, pulsar,
  soltar y clic.
- Procesa los raffles de uno en uno, en orden del DOM.

El detalle está en `modules/raffles/README.md`.

---

## 2. Estructura del proyecto

```text
andypsx-extension/
├── manifest.json
├── background.js              ← service worker: aplica/quita el CSS
├── content.js                 ← arranca módulos de contenido y detecta sesión
├── session-probe.js           ← detecta sesión en pestañas abiertas tras actualizar
├── core/
│   ├── config.js              ← ⭐ ÚNICO archivo para cambiar la página objetivo
│   ├── storage.js             ← estado de módulos y migración
│   ├── url.js                 ← comprobación de URL y patrones
│   ├── css.js                 ← insertCSS/removeCSS y cola por pestaña
│   ├── bus.js                 ← eventos locales entre módulos de contenido
│   ├── registry.js            ← monta/desmonta content.js por módulo
│   ├── session.js             ← detecta y guarda el estado de sesión
│   └── actions.js             ← esperas, botón y clic humano
├── modules/
│   ├── index.js               ← registro de módulos
│   ├── README.md              ← contrato para añadir módulos
│   ├── vista-limpia/
│   │   ├── index.js
│   │   ├── live.css           ← ⭐ EL CSS que se inyecta
│   │   └── README.md
│   └── raffles/
│       ├── index.js
│       ├── content.js
│       └── README.md
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── ui/
│   └── theme.css
├── icons/
└── README.md
```

---

## 3. Instalación

1. Abre `chrome://extensions` (o `edge://extensions`).
2. Activa **Modo de desarrollador**.
3. Pulsa **"Cargar descomprimida"**.
4. Selecciona la carpeta raíz de esta extensión.
5. Abre la página objetivo y pulsa el icono de la extensión.

Después de cambiar `background.js`, `content.js`, `core/` o
`modules/index.js`, pulsa recargar en la tarjeta de la extensión. Después de
cambiar un `content.js` de módulo o un `live.css`, recarga también la página
objetivo.

---

## 4. Cambiar la página objetivo (un solo archivo)

Edita **solo** `core/config.js`:

```js
export const TARGETS = {
  local: {
    url: "http://127.0.0.1:8765/index.html",
  },
  production: {
    url: "https://andypsx.com/live",
  },
};

export const ACTIVE_TARGET = "production";
```

- `"production"`: aplica CSS y raffles en `https://andypsx.com/live`.
- `"local"`: aplica CSS y raffles en la copia local servida en
  `http://127.0.0.1:8765/index.html`.

Después de cambiar `ACTIVE_TARGET`:

1. Recarga la extensión en `chrome://extensions`.
2. Recarga la página objetivo.

Si cambias el archivo con la extensión ya cargada, el background detecta que el
target del content script no coincide y recarga la extensión automáticamente.
Si no lo hace, recarga la extensión a mano.

El manifest ya permite `andypsx.com`, `127.0.0.1` y `localhost`. Los puertos
locales no hace falta declararlos: `http://127.0.0.1/*` cubre cualquier puerto.
Si algún día cambias a otro dominio, añádelo a `host_permissions`,
`content_scripts.matches` y `web_accessible_resources.matches`.

### Probar en local

El proyecto de capturas está en `Automatizaciones/andypsx`. Sirve la copia más
reciente:

```bash
cd /home/manager/Automatizaciones/andypsx/proxy
uv run download_offline.py --serve
```

También vale un servidor estático normal:

```bash
cd /home/manager/Automatizaciones/andypsx/proxy/downloads/02-11-2026-19-41
python3 -m http.server 8765 --bind 127.0.0.1
```

Abre `http://127.0.0.1:8765/index.html`, enciende los toggles y comprueba:

- Vista limpia aplica y quita el CSS sin recargar, solo si la tarjeta
  **Tu directo** muestra `Desconectar`.
- Si la tarjeta muestra `Inicia sesión`, el toggle de Vista limpia queda
  deshabilitado y el CSS no se aplica.
- Raffles omite los raffles con contraseña.
- En una copia con raffles sin contraseña, espera y pulsa `Participar`.

Para probar sin sesión, reemplaza el contenido de
`section[aria-label="Tu cuenta del directo"]` por el estado de la imagen sin
sesión, o abre `https://andypsx.com/live` en un navegador sin cookies.

### Diagnóstico rápido

- `Sesión sin comprobar`: el content script de la pestaña no responde. El
  background intenta inyectar `session-probe.js`. Si sigue igual, usa
  **Recargar página** en el popup.
- `Vista limpia no coincide ... resincronizando` repetido: el background no está
  aplicando el CSS. Revisa que la pestaña actual sea la página objetivo. Si el
  target cambió, el background recarga la extensión automáticamente.
- `[andypsx-live] Error al insertar CSS`: `insertCSS` falló. Revisa la ruta del
  CSS y los permisos del manifest.
- Si tras recargar extensión y página sigue igual, revisa que no haya otra copia
  de la extensión cargada o Stylus aplicando el mismo CSS.

---

## 5. Cómo funciona (por dentro)

### CSS

```text
[popup]  →  chrome.storage.sync.set({ modules: { "vista-limpia": { enabled } } })
                  │
                  ▼
[background.js]  →  storage.onChanged
                  │
                  ├─ ON  → chrome.scripting.insertCSS(tab, modules/vista-limpia/live.css)
                  └─ OFF → chrome.scripting.removeCSS(tab, modules/vista-limpia/live.css)
```

### Módulos de contenido

```text
[content.js]  →  lee modules/index.js
              →  lee chrome.storage.sync
              →  registry.sync(ids activos)
              →  importa modules/<id>/content.js
              →  ejecuta init(ctx) o destroy()
```

- `core/registry.js` monta y desmonta módulos sin recargar la página.
- `content.js` escucha cambios de storage y de URL.
- El módulo de raffles usa `MutationObserver` para detectar raffles nuevos.
- `core/bus.js` ofrece eventos locales (`ctx.bus.emit` / `ctx.bus.on`).
- El estado de módulos se guarda en `chrome.storage.sync`.
- El estado de sesión se guarda en `chrome.storage.local`.
- El **badge** del icono muestra `ON` (verde) / `OFF` (gris) si hay algún módulo
  activo.
- `modules/index.js` registra los módulos. El popup los muestra todos.
- Los módulos CSS usan `hasContent: false` para que el content script no intente
  cargar un `content.js` inexistente.
- `core/css.js` también elimina el archivo antiguo `styles/live.css` en pestañas
  abiertas. Al actualizar desde v1.0.x, recarga la extensión una vez; si queda
  algún resto visual, recarga también la página.

### Sesión

```text
[content.js]  →  busca section[aria-label="Tu cuenta del directo"]
              →  Desconectar / Tus Mochuelos  = sesión iniciada
              →  Inicia sesión                = sin sesión
              →  Reconectar Live               = live desconectado
              →  guarda chrome.storage.local.session
              →  avisa al background por mensaje
                       │
                       ▼
[background.js]  →  aplica requiresSession
                 →  inserta o quita live.css
                 →  si la pestaña no responde, inyecta session-probe.js

[popup]  →  lee session y deshabilita Vista limpia sin sesión
         →  muestra la URL actual y botón para abrir/recargar
```

- La tarjeta se revisa al cargar, con `MutationObserver`, cada 2 s, al cambiar
  de URL y al volver a la pestaña.
- El popup pide el estado fresco al content script de la pestaña activa.
- Si la pestaña ya estaba abierta antes de recargar la extensión, el background
  inyecta `session-probe.js` para no obligar a recargar la página.
- Si el popup detecta sesión sin comprobar, muestra “Sesión sin comprobar” y un
  botón para recargar la página.
- `content.js` compara el CSS aplicado con el estado deseado. Si no coincide,
  pide `modules:sync` al background.
- Si no se puede comprobar la sesión, Vista limpia queda apagada.
- El login de la cabecera y el login de Kick no cuentan.

### Migración desde v1.0.x

La versión antigua guardaba un booleano en `andypsxLiveEnabled`. Al leer el
estado, `core/storage.js` lo migra a:

```json
{
  "modules": {
    "vista-limpia": {
      "enabled": true,
      "settings": {}
    }
  }
}
```

Después elimina la clave antigua. El usuario conserva su ON/OFF. Los módulos
nuevos reciben su `defaultEnabled`.

---

## 6. El CSS

Todo el estilo está en `modules/vista-limpia/live.css`.

Los selectores usan, de más fuerte a más débil:

1. `aria-label` / `aria-labelledby`
2. `id`
3. atributos `data-*`
4. `:has()` con contenido semántico
5. clases Tailwind
6. `:nth-child` / `:last-child`

Los `aria-label` llevan el nombre del día detrás de los dos puntos:

```text
"Guess: 23 BONOS CUANTO SACAMOS"   ← mañana será otro
"Apuesta: 23 BONOS CUANTO SACAMOS" ← mañana será otro
"Raffle: Raffle 5 × $5"            ← cambia también
```

Por eso se usan selectores que empiezan por (`^=`), que no dependen del nombre
del día:

```css
section[aria-label^="Guess:"]   { /* → columna 5 */ }
section[aria-label^="Apuesta:"] { /* → columna 4 */ }
section[aria-label^="Raffle:"]  { /* → columna 1 */ }
```

El detalle de cada bloque está en `modules/vista-limpia/README.md`.

---

## 7. Añadir otro módulo

El contrato completo está en `modules/README.md`.

### Módulo CSS

1. Crea `modules/<id>/index.js`:

```js
export const definition = {
  id: "ejemplo",
  name: "Ejemplo",
  description: "Ajuste extra para el directo.",
  matches: ["/*"],
  defaultEnabled: false,
  hasContent: false,
  requiresSession: false,
  styles: ["ejemplo.css"],
};
```

2. Crea `modules/<id>/ejemplo.css`.

3. Regístralo en `modules/index.js`.

### Módulo de contenido

1. Crea `modules/<id>/index.js`:

```js
export const definition = {
  id: "ejemplo",
  name: "Ejemplo",
  description: "Hace algo en la página.",
  matches: ["/*"],
  defaultEnabled: false,
  hasContent: true,
  requiresSession: false,
};
```

2. Crea `modules/<id>/content.js`:

```js
export function init(ctx) {
  ctx.log("activo");
}

export function destroy() {
  // limpiar observers, timers, listeners y atributos
}
```

3. Regístralo en `modules/index.js`.

Recarga la extensión. El popup mostrará el nuevo toggle automáticamente.

Si el módulo necesita sesión iniciada, añade `requiresSession: true`. El
background y el popup lo bloquearán cuando la tarjeta **Tu directo** muestre
`Inicia sesión`.

---

## 8. Empaquetar

```bash
cd /home/manager/Downloads
zip -r andypsx-extension-v1.3.3.zip andypsx-extension-v1.0.4 \
  -x '*/.git/*' '*/__pycache__/*'
```

O en `chrome://extensions` → **"Empaquetar extensión"**.

> Para **Firefox**, `chrome.*` funciona igual con `browser.*`; solo haría falta
> duplicar `manifest.json` con `"browser_specific_settings.gecko.id"` para
> publicar en addons.mozilla.org.
