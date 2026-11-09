const POINTER_MOVE_STEPS = 4;

// Falso cuando la extensión se recarga/actualiza con la pestaña abierta: el
// content script viejo conserva su mundo aislado pero pierde chrome.runtime.
function backgroundAvailable() {
  try {
    return (
      typeof globalThis.chrome !== "undefined" &&
      typeof globalThis.chrome.runtime?.sendMessage === "function"
    );
  } catch {
    return false;
  }
}

export function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

// Esperas largas de raffles: se programan en el background con chrome.alarms
// porque en una pestaña en segundo plano los setTimeout se ahogan (≥1 s, y tras
// minutos a ~1/min). Si el background no responde, cae a la espera local.
// Margen sobre la espera pedida antes de dar la alarma por perdida.
const ALARM_GRACE_MS = 2000;

export async function waitForRaffleDelay(milliseconds) {
  const delayMs = Math.max(0, Math.round(milliseconds));
  const startedAt = Date.now();

  // Si el contexto de la extensión está invalidado, espera local directamente.
  if (!backgroundAvailable()) {
    await wait(delayMs);
    return;
  }

  // La alarma puede no responder nunca (create falla, el service worker se
  // reinicia y pierde la espera pendiente). Sin este límite la cola de
  // raffles quedaba colgada y no llegaba a hacer clic.
  const alarm = chrome.runtime
    .sendMessage({ type: "wait:alarm", delayMs })
    .then((response) => response?.ok === true)
    .catch(() => false);
  const timeout = wait(delayMs + ALARM_GRACE_MS).then(() => false);

  if (await Promise.race([alarm, timeout])) return;

  // Fallo o sin respuesta: completa solo lo que falte de la espera original.
  const remaining = delayMs - (Date.now() - startedAt);
  if (remaining > 0) await wait(remaining);
}

export function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

export function isButtonDisabled(button) {
  return (
    Boolean(button.disabled) ||
    button.getAttribute("aria-disabled") === "true"
  );
}

function baseEventOptions(type, x, y, buttons) {
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: window.screenX + x,
    screenY: window.screenY + y,
    button: 0,
    buttons,
    detail: type === "click" ? 1 : 0,
  };
}

function pointerEvent(type, x, y, buttons) {
  const options = {
    ...baseEventOptions(type, x, y, buttons),
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
  };

  if (typeof PointerEvent === "function") {
    return new PointerEvent(type, options);
  }

  return new MouseEvent(type, options);
}

function mouseEvent(type, x, y, buttons) {
  return new MouseEvent(type, baseEventOptions(type, x, y, buttons));
}

async function prepareClick(element, shouldStop) {
  if (!element || !element.isConnected) return null;

  element.scrollIntoView({ block: "center", behavior: "auto" });
  await wait(randomBetween(200, 500));
  if (shouldStop()) return null;

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const targetX = rect.left + rect.width * randomBetween(0.3, 0.7);
  const targetY = rect.top + rect.height * randomBetween(0.3, 0.7);
  const startX = targetX + randomBetween(-90, 90);
  const startY = targetY + randomBetween(-60, 60);
  const moves = [];

  for (let step = 1; step <= POINTER_MOVE_STEPS; step += 1) {
    const progress = step / POINTER_MOVE_STEPS;
    moves.push({
      x: startX + (targetX - startX) * progress,
      y: startY + (targetY - startY) * progress,
      waitMs: randomBetween(25, 70),
    });
  }

  return {
    targetX,
    targetY,
    moves,
    hoverWaitMs: randomBetween(80, 220),
    pressWaitMs: randomBetween(70, 180),
    releaseWaitMs: randomBetween(30, 90),
  };
}

export async function humanClick(element, { shouldStop = () => false } = {}) {
  const plan = await prepareClick(element, shouldStop);
  if (!plan) return false;

  for (const move of plan.moves) {
    if (shouldStop()) return false;

    element.dispatchEvent(pointerEvent("pointermove", move.x, move.y, 0));
    element.dispatchEvent(mouseEvent("mousemove", move.x, move.y, 0));

    await wait(move.waitMs);
  }

  if (shouldStop()) return false;

  element.focus?.();
  element.dispatchEvent(
    pointerEvent("pointerover", plan.targetX, plan.targetY, 0),
  );
  element.dispatchEvent(mouseEvent("mouseover", plan.targetX, plan.targetY, 0));

  await wait(plan.hoverWaitMs);
  if (shouldStop()) return false;

  element.dispatchEvent(
    pointerEvent("pointerdown", plan.targetX, plan.targetY, 1),
  );
  element.dispatchEvent(mouseEvent("mousedown", plan.targetX, plan.targetY, 1));

  await wait(plan.pressWaitMs);
  if (shouldStop()) return false;

  element.dispatchEvent(pointerEvent("pointerup", plan.targetX, plan.targetY, 0));
  element.dispatchEvent(mouseEvent("mouseup", plan.targetX, plan.targetY, 0));

  await wait(plan.releaseWaitMs);
  if (shouldStop()) return false;
  if (!element.isConnected || isButtonDisabled(element)) return false;

  element.click();
  return true;
}

export async function trustedHumanClick(element, { shouldStop = () => false } = {}) {
  const plan = await prepareClick(element, shouldStop);
  if (!plan || shouldStop()) return false;

  // Contexto invalidado: no hay quién ejecute el clic trusted; se omite.
  if (!backgroundAvailable()) return false;

  let response;

  try {
    response = await chrome.runtime.sendMessage({
      type: "trusted-click",
      targetX: plan.targetX,
      targetY: plan.targetY,
      moves: plan.moves,
      hoverWaitMs: plan.hoverWaitMs,
      pressWaitMs: plan.pressWaitMs,
      releaseWaitMs: plan.releaseWaitMs,
    });
  } catch {
    return false;
  }

  return response?.ok === true;
}
