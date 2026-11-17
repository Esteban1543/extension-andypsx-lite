# Bajo consumo

Corta las animaciones decorativas de `/live` para que cada perfil abierto
gaste la mínima CPU. Solo CSS, sin content script, sin requisito de sesión.

## Por qué

La web define más de 100 `@keyframes`; muchos son infinitos y varios animan
`text-shadow`, `box-shadow` o `background-position`, que se recalculan en el
hilo principal en cada fotograma. Con N perfiles abiertos (AdsPower), cada
uno repinta a 60 fps sin que nadie lo mire.

## Cómo

```css
*,
*::before,
*::after {
  animation-duration: 0.01ms !important;
  animation-delay: 0s !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.01ms !important;
  transition-delay: 0s !important;
}
```

- **No** se usa `animation: none`: dejaría invisibles los elementos que
  nacen con `opacity: 0` y solo se muestran por una animación `forwards`
  (p. ej. `.psx-aparece` de la propia web).
- `animationend` / `transitionend` se siguen disparando, así que la lógica
  del sitio que depende de esos eventos sigue funcionando.
- Los bucles infinitos (marquesina de "live", halos, llamas, barridos) se
  ejecutan una vez en menos de un milisegundo y se quedan quietos.

## Notas

- `prefers-reduced-motion` no sirve por sí solo: la web solo lo respeta en
  algunos componentes. Este módulo lo impone globalmente.
- El flag de arranque `--force-prefers-reduced-motion` en los perfiles de
  AdsPower es un complemento (corta también las animaciones de JS como las
  de framer-motion), pero este CSS no depende de él.
- Los `backdrop-filter` / `filter: blur` no se tocan: se midieron aparte.
