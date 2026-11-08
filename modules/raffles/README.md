# Módulo Raffles

Detecta los raffles activos del directo y pulsa `Participar` en los que no
tienen contraseña. Procesa los raffles de uno en uno, con esperas aleatorias y
clic humano.

## Qué detecta

- Contenedor activo: `section[aria-label^="Raffle:"]`.
- Botón: `form button[type="submit"]` o un botón cuyo texto contenga
  `particip`.
- Contraseña: `input[aria-label="Contraseña del raffle"]` o
  `form input[type="password"]`.
- El historial `section[aria-labelledby="tus-raffles-directo"]` no se trata como
  raffle activo.
- Puede haber cero, uno o varios raffles. Se procesan todos, en orden del DOM.

## Omisiones

No se pulsa `Participar` si:

- el raffle tiene contraseña → `skipped: "password-required"`;
- ya aparece como participado → `already`;
- no hay botón → `no-button`;
- el botón está deshabilitado → `button-disabled`;
- el botón desaparece o no se puede pulsar tras la espera → `no-button` o
  `not-clickable`;
- ocurre un error → `error`.

Los raffles con contraseña se omiten antes de esperar. No consumen la espera del
primer clic.

## Esperas

```js
FIRST_CLICK_DELAY_MS = { min: 5000, max: 10000 };
NEXT_CLICK_DELAY_MS = { min: 2000, max: 5000 };
```

- Primer clic de cada tanda: **5–10 s**.
- Clics siguientes de la misma tanda: **2–5 s**.
- Si se abren 5 raffles a la vez: primero 5–10 s, los otros cuatro 2–5 s entre
  cada uno.
- Si la cola queda vacía y después aparece otro raffle, vuelve a contar como
  primera tanda.
- La espera ocurre después de confirmar que el botón está habilitado y antes de
  iniciar la secuencia de clic.
- Si el botón se deshabilita durante la espera, el raffle se omite sin forzar el
  clic.

Las constantes están al inicio de `content.js`.

## Clic humano

Por defecto (`trustedClicks: false`), `core/actions.js` hace:

1. `scrollIntoView` al centro.
2. Pausa aleatoria de 200–500 ms.
3. Punto aleatorio dentro del 30–70 % central del botón.
4. Movimiento en 4 pasos con `pointermove` / `mousemove`.
5. `pointerover` / `mouseover`.
6. Pausa de 80–220 ms.
7. `pointerdown` / `mousedown`.
8. Pausa de 70–180 ms.
9. `pointerup` / `mouseup`.
10. Pausa de 30–90 ms.
11. `element.click()`.

Los eventos llevan coordenadas del botón, `button`, `buttons`, `view` y
`pointerType: "mouse"`.

**Límite:** ningún evento sintético tiene `event.isTrusted === true`. La página
puede detectarlo.

Con `trustedClicks: true`, el content script envía el plan de movimiento al
background y el background usa `chrome.debugger` +
`Input.dispatchMouseEvent` para generar un clic trusted real. El debugger se
adjunta solo durante el clic y se desadjunta al terminar. Trade-offs:

- Permiso `debugger` con advertencia al instalar.
- Barra “Chrome está siendo controlado por software de prueba” mientras está
  adjunto.
- DevTools abierto puede impedir `chrome.debugger.attach`.

Cómo activarlo: checkbox «Clics indetectables (permiso debugger)» en el popup,
bajo el módulo Raffles. El ajuste se guarda en
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

## Estado en memoria

No se escriben atributos `data-*` en el DOM. Cada tarjeta tiene un registro en
memoria:

```js
{
  id: "r1",
  delayMs: 7341,
  clicked: true,
  skipped: null
}
```

Ese estado se usa para logs y para el evento `raffles:clicked`. Al desactivar el
módulo se detiene la cola y se descarta el estado.

## Eventos del bus

En cada escaneo:

```js
ctx.bus.emit("raffles:snapshot", {
  count: 1,
  raffles: [
    {
      id: "r1",
      title: "Raffle 5 × $5",
      subtitle: "5 × $5 · Tip en Gamdom",
      requirements: ["Solo verificados"],
      participants: "825",
      closesIn: "01:55",
      action: { label: "Participar", disabled: false },
      passwordRequired: false,
      status: null,
    },
  ],
});
```

Después de cada clic:

```js
ctx.bus.emit("raffles:clicked", {
  id: "r1",
  title: "Raffle 5 × $5",
  at: 1730000000000,
  delayMs: 7341,
  trusted: false,
});
```

## Logs

Los logs están detrás del flag `debug`:

```js
chrome.storage.local.set({ debug: true });
```

```text
[raffles] Raffles activos: 3.
[raffles] Detectado: SOLO ANDY SORTEO 10$ CASH - 30 GANADORES
[raffles] Raffle omitido, requiere contraseña: SOLO ANDY SORTEO 10$ CASH...
[raffles] Esperando 7.3s antes de participar: Raffle 5 × $5
[raffles] Clic en Participar: Raffle 5 × $5
```

## Prueba local

- `02-11-2026-19-41`: 3 raffles con contraseña. Deben quedar todos con
  `password-required` y no debe haber clics.
- `27-10-2026-15-23`: 1 raffle sin contraseña y botón habilitado. Debe esperar
  5–10 s y pulsar.
- Para probar 5 a la vez, clona el raffle sin contraseña en el DOM. El
  `MutationObserver` los detecta y los añade a la cola.
- Para evitar que el formulario estático recargue la página durante la prueba,
  intercepta el `click` y ejecuta `preventDefault()`.

## Mantenimiento

Si cambian los textos o la estructura, actualiza los selectores por `aria-label`
y el texto del botón. El módulo no depende de clases Tailwind.
