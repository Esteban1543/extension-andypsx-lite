# Módulo Vista limpia

Reordena la barra lateral de `andypsx.com/live` y oculta los bloques que no
forman parte del directo. Solo CSS.

## Definición

```js
export const definition = {
  id: "vista-limpia",
  name: "Vista limpia",
  description: "Reordena el directo en 5 columnas y oculta lo que no hace falta.",
  matches: ["/*"],
  defaultEnabled: true,
  legacyState: true,
  hasContent: false,
  requiresSession: true,
  styles: ["live.css"],
};
```

- `matches`: rutas relativas al target activo. `/*` aplica a todo el origen.
- `legacyState`: migra el booleano antiguo `andypsxLiveEnabled`.
- `hasContent: false`: el content script no intenta cargar un `content.js`; este
  módulo es solo CSS.
- `requiresSession: true`: solo se aplica si la tarjeta **Tu directo** muestra
  sesión iniciada.
- `styles`: archivos CSS dentro de esta carpeta.

## Requisito de sesión

El content script busca:

```text
section[aria-label="Tu cuenta del directo"]
```

y decide:

- `Desconectar` o `Tus Mochuelos` → sesión iniciada.
- `Inicia sesión` / `Iniciar sesión` → sin sesión.
- `Reconectar Live` o “sesión del directo ha caducado” → live desconectado.
- skeleton, `…` o sin marcas → desconocido.

El otro botón `Iniciar Sesión` de la cabecera no cuenta. Tampoco cuenta el login
de Kick.

Si no hay sesión:

- el background no inyecta `live.css`;
- el popup deshabilita el toggle de Vista limpia;
- la preferencia guardada se conserva y se vuelve a aplicar al iniciar sesión.

Si el background no aplica el CSS, `content.js` inyecta un `<style>` local con
`live.css` como respaldo. Al cerrar sesión o apagar el módulo, ese estilo se
elimina.

## Bloques del CSS

1. **Ocultar**: cabecera, título, pie, directo, Bonus Hunt, Soporte,
   "Tu directo", promo de extensión y columnas sobrantes del grid.
2. **Orden**: RAFLES (1), CAJAS (2), APUESTAS (3), GUESSES (4).
3. **Liberar la barra lateral**: el grid principal deja de reservar 272 px.
4. **Rejilla de 5 columnas** en `≥1200px`. Raffles apilados; Cajas ocupa dos
   columnas; Apuestas y Guess tienen columna propia. Los huecos vacíos se
   dibujan con `::before` / `::after`.
5. **Cajas**: botones VIEWER / SUBS en dos columnas; lista de ganadores flotante
   con scroll fino y orden inverso.
6. **Pantallas medianas** `641–1199px`: dos tarjetas por fila.
7. **Móvil** `≤640px`: una tarjeta por fila.
8. **Sin directo**: si no hay Raffle, Cajas, Apuesta ni Guess, la tarjeta de
   aviso se centra y se ocultan los huecos punteados.

## Estrategia de selectores

De más fuerte a más débil:

1. `aria-label` / `aria-labelledby`
2. `id`
3. atributos `data-*`
4. `:has()` con contenido semántico
5. clases Tailwind
6. `:nth-child` / `:last-child`

Los `aria-label` cambian cada día:

```text
"Guess: 23 BONOS CUANTO SACAMOS"
"Apuesta: 23 BONOS CUANTO SACAMOS"
"Raffle: Raffle 5 × $5"
```

Por eso se usan prefijos (`^=`):

```css
section[aria-label^="Guess:"]
section[aria-label^="Apuesta:"]
section[aria-label^="Raffle:"]
```

## Editar el CSS

1. Edita `live.css`.
2. Recarga la extensión en `chrome://extensions`.
3. Recarga la página objetivo.

No cambies `origin` en `core/css.js`. Debe ser `"AUTHOR"`. Con `"USER"`, el
`!important` de la extensión se vuelve important de usuario y aplasta los
`!important` del sitio; el aspecto de botones y tarjetas cambia.

## Probar en local

En `core/config.js`:

```js
export const ACTIVE_TARGET = "local";
```

Sirve la captura en `http://127.0.0.1:8765/index.html`, recarga la extensión y
abre la página. El mismo CSS se aplica a la copia local.

La copia local puede no tener Raffle o Guess activos. En ese caso se ven los
huecos punteados de RAFLES / GUESSES y el resto de bloques disponibles.
