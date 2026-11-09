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
│   ├── config.js              ← target detectado por hostname (sin editar)
│   ├── storage.js             ← estado de módulos y migración
│   ├── url.js                 ← comprobación de URL y patrones
│   ├── css.js                 ← insertCSS/removeCSS y cola por pestaña
│   ├── bus.js                 ← eventos locales entre módulos de contenido
│   ├── registry.js            ← monta/desmonta content.js por módulo
│   ├── session.js             ← detecta y guarda el estado de sesión
│   ├── log.js                 ← logs condicionados por debug
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

## 4. Página objetivo (detectada automáticamente)

No hay constante de target que editar ni commitear. `core/config.js` detecta
el objetivo en runtime según el hostname de la URL visitada:

- `https://andypsx.com/...` → producción (actúa en `/live`).
- `http://127.0.0.1:<puerto>/...` o `http://localhost:<puerto>/...` → copia
  local (actúa en `/` y `/index.html`, cualquier puerto).

La misma build funciona en ambos sitios sin tocar nada. El popup muestra el
target de la pestaña activa y «Abrir página objetivo» abre ese target
(producción por defecto).

La sesión guardada se valida contra el origin de la página que la reportó:
una sesión detectada en local no activa Vista limpia en producción ni al revés.

Si algún día añades otro dominio, decláralo en `host_permissions`,
`content_scripts.matches` y `web_accessible_resources.matches`, y añade el
hostname a `core/config.js` (`targetForUrl`).

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
- `Vista limpia no coincide ... comprobando CSS`: el background no está
  aplicando el CSS. El content script reintenta con backoff (1 s, 2 s, 4 s…
  techo 8 s) mientras el estado deseado no se aplique; un fallo transitorio
  se recupera solo. Si sigue igual tras ~10 s, recarga la extensión y la
  página: el background puede estar muerto o el `insertCSS` fallando de
  verdad.
- `Error al insertar CSS` (solo con `debug` on): `insertCSS` falló. Revisa la
  ruta del CSS y los permisos del manifest.
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
- El estado de sesión se guarda en `chrome.storage.local` **por origin**
  (`session:https://andypsx.com`, `session:http://127.0.0.1:8765`): la copia
  local y producción no se pisan. La clave única antigua `session` se migra
  sola la primera vez que la extensión la lee.
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
  pide confirmación al background (`css:ensure`) y reintenta con backoff
  (1 s, 2 s, 4 s… techo 8 s) **sin límite de intentos**: un fallo transitorio
  del background o de `insertCSS` se recupera solo en el siguiente ciclo.
- No hay fallback local: Vista limpia depende solo de `insertCSS` del
  background (ver P1 en la sección 8). Si el background está realmente
  muerto, el CSS no se aplica y no queda rastro en la página.
- Si no se puede comprobar la sesión, Vista limpia queda apagada.
- El login de la cabecera y el login de Kick no cuentan.

### Segundo plano y keep-alive

Para que nada se duerma con muchas pestañas o el perfil en segundo plano:

- **Puerto `keepalive`**: el content script abre `chrome.runtime.connect` y lo
  reconecta si se cierra. Un canal de larga duración mantiene despierto al
  service worker (comportamiento de MV3), así `css:ensure` y `trusted-click`
  responden al instante.
- **Latido con `chrome.alarms`** cada 30 s como respaldo: despierta al SW si el
  puerto se cerró. Permiso `alarms` declarado en el manifest.
- **`autoDiscardable: false`** en las pestañas objetivo: Chrome no las descarta
  por memoria (Memory Saver), así el DOM y la cola de raffles no se congelan.
- **Esperas de raffles con `chrome.alarms`**: la espera de 5–10 s / 2–5 s se
  programa en el background (`wait:alarm`), no con `setTimeout` en la pestaña.
  En una pestaña en segundo plano los timers se ahogan (≥1 s, tras minutos a
  ~1/min); las alarmas no. Si la alarma falla o no responde (p. ej. el service
  worker se reinicia y pierde la espera), a los `espera + 2 s` el módulo
  completa la espera local y hace el clic igualmente: la cola nunca se queda
  colgada.
- **Latido de escaneo (`scan`)**: cada 30 s el background pide un `scan()` a
  las pestañas objetivo (`scan:request`). Es un refuerzo al `MutationObserver`
  para que la detección de raffles nuevos siga siendo regular en segundo plano,
  no un reemplazo. El escaneo es de solo lectura: no crea atributos, nodos ni
  ninguna huella nueva en la página. El listener solo existe mientras el módulo
  Raffles está activo y se elimina al desactivarlo.
- **Contexto invalidado**: si recargas o actualizas la extensión con la pestaña
  abierta, el content script viejo pierde su `chrome.runtime`. Un chequeo
  ligero (`ping` cada 3 s) lo detecta, desmonta módulos y temporizadores y se
  detiene en silencio. Así no aparecen errores `Cannot read properties of
  undefined (reading 'sendMessage')` ni `Extension context invalidated` en la
  página. Para que la pestaña vuelva a tener la extensión activa, recárgala
  (F5); el content script nuevo se inyecta solo.

Límites honestos: el keep-alive es *best-effort* (MV3 está pensado para
suspender el SW), y una pestaña **congelada del todo** retrasa el clic hasta
que descongela — `autoDiscardable` evita el descarte, no el congelamiento.
El Modo de Eficiencia de Windows (Process Lasso) cubre el lado del SO; esto
cubre el lado del navegador.

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

## 8. Detectabilidad y privacidad

### P1 — Sin fallback de CSS visible (opción A: sin fallback)

Decisión tomada en v1.5.0: **el fallback con `CSSStyleSheet` +
`document.adoptedStyleSheets` se eliminó por completo**.

Por qué: `document.adoptedStyleSheets` es una propiedad pública y enumerable
del documento, y las reglas de una hoja construible se pueden leer con
`[...sheet.cssRules]` (MDN «Document.adoptedStyleSheets», CSSOM
`dom-documentorshadowroot-adoptedstylesheets`). La página podía hacer:

```js
const mia = document.adoptedStyleSheets.find(s =>
  [...s.cssRules].some(r => /data-cabecera-sitio/.test(r.cssText)));
```

Es decir: el fallback era detectable en cuanto actuaba. Con la opción A:

- Vista limpia depende solo de `chrome.scripting.insertCSS` (origin AUTHOR,
  sin nodo en el DOM, no enumera en `document.styleSheets` de la página ni en
  `adoptedStyleSheets`).
- Si el `insertCSS` o el background fallan, el content script reintenta con
  backoff (1 s, 2 s, 4 s… techo 8 s) **sin límite**: un fallo transitorio se
  recupera solo. No hay caché de CSS cuyo rechazo envenene reintentos.
- Si el background está realmente muerto, Vista limpia no se aplica: fallo
  silencioso, **no detectable**. Se prefirió «no funciona» a «funciona y
  delata».
- Con un `insertCSS` que falla siempre, la página ve
  `document.adoptedStyleSheets.length === 0`.

No se parchea el prototipo de `Document` para ocultar nada: cambiar
descriptores del mundo de la página sería más detectable todavía.

### P2 — Sin atributos `data-*`

El módulo Raffles guarda `id`, `delayMs`, `clicked` y `skipped` en memoria
(`WeakMap`). No escribe atributos en las tarjetas del sitio.

### P3 — Clics confiables opcionales

Por defecto:

```json
"trustedClicks": false
```

En ese modo se mantiene el clic sintético actual. Los eventos tienen
`isTrusted === false`; la página puede detectarlo.

El ajuste se controla desde el **popup**: el módulo Raffles tiene el checkbox
«Clics indetectables (permiso debugger)». Se guarda en
`modules.raffles.settings.trustedClicks` y el módulo lo lee en el momento del
clic, así que aplica al raffle siguiente sin reiniciar nada. También se puede
cambiar a mano:

```js
chrome.storage.sync.get("modules").then(({ modules = {} }) => {
  const raffles = modules.raffles ?? {};
  chrome.storage.sync.set({
    modules: {
      ...modules,
      raffles: {
        ...raffles,
        settings: { ...(raffles.settings ?? {}), trustedClicks: true },
      },
    },
  });
});
```

Con `trustedClicks: true` el background usa `chrome.debugger` +
`Input.dispatchMouseEvent` y adjunta el debugger solo durante el clic.

Trade-offs:

- El permiso `debugger` muestra una advertencia al instalar.
- Mientras el debugger está adjunto aparece la barra “Chrome está siendo
  controlado por software de prueba”. El popup avisa al activarlo.
- Si DevTools está abierto en la pestaña, `chrome.debugger.attach` puede fallar
  y el raffle se omite.
- El clic trusted es por coordenadas: un overlay del sitio (modal, banner)
  que cubra el botón lo intercepta, igual que le pasaría a un usuario real
  con el ratón. Ciérralo y el siguiente raffle se pulsa normal.
- El ajuste va en `chrome.storage.sync` (como el resto de la configuración de
  módulos): si sincronizas tu cuenta en otro equipo, actívalo/apágalo allí.

### P4 — CSS fuera de `web_accessible_resources`

`modules/*/*.css` ya no está expuesto. La página no puede hacer
`fetch('chrome-extension://<id>/modules/vista-limpia/live.css')`.

Los JS (`core/*.js`, `modules/*/content.js`, etc.) siguen en
`web_accessible_resources` porque el content script los importa dinámicamente.
Conociendo el ID de la extensión, la página puede enumerarlos. No exponen
secretos, pero sí revelan que hay una extensión.

### P5 — Riesgo aceptado

La función es visible por definición: `header[data-cabecera-sitio]` y `footer`
en `display:none`, la barra lateral en 5 columnas, etc. Son detectables con
`getComputedStyle` y `getBoundingClientRect`. No hay mitigación real sin
eliminar Vista limpia.

### P6 — Higiene

- Sin `__andypsx*`, `data-andypsx*` ni IDs con el nombre del proyecto en el DOM.
- Todos los logs (informativos **y errores**) están detrás de `debug`:
  ```js
  chrome.storage.local.set({ debug: true });
  ```
  Recarga la extensión/página para aplicarlo. Sin `debug` no se imprime nada,
  y nunca se imprime un stack trace: el stack incluye
  `chrome-extension://<id>/…`, que delata el ID y rutas internas.
- El content script sigue en mundo aislado (`world` no se toca).
- No se crean globales en `window`.

### Métrica de `document.styleSheets` (baseline honesta)

Al comparar `document.styleSheets.length` con y sin extensión, la baseline debe
medirse en el **mismo navegador, misma página y mismo tiempo de espera**: el
propio sitio inyecta un `<style>#app-splash` duplicado al hidratar (artefacto
de Next.js), así que la cuenta puede subir de 4 a 5 **sin** extensión. En las
pruebas contra `https://andypsx.com/live` (mismo navegador, misma espera de
hidratación) la extensión deja la cuenta idéntica a la baseline; el `<style>`
del splash del sitio explicaba la diferencia 4 vs 5 del informe anterior.

---

## 9. Empaquetar

```bash
cd /home/manager/Downloads
zip -r andypsx-extension-v1.6.3.zip andypsx-extension-v1.0.4 \
  -x '*/.git/*' '*/__pycache__/*'
```

O en `chrome://extensions` → **"Empaquetar extensión"**.

> Para **Firefox**, `chrome.*` funciona igual con `browser.*`; solo haría falta
> duplicar `manifest.json` con `"browser_specific_settings.gecko.id"` para
> publicar en addons.mozilla.org.
