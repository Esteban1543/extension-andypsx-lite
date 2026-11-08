const POINTER_MOVE_STEPS = 4;

export function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
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

async function movePointer(element, fromX, fromY, toX, toY, shouldStop) {
  for (let step = 1; step <= POINTER_MOVE_STEPS; step += 1) {
    if (shouldStop()) return false;

    const progress = step / POINTER_MOVE_STEPS;
    const x = fromX + (toX - fromX) * progress;
    const y = fromY + (toY - fromY) * progress;

    element.dispatchEvent(pointerEvent("pointermove", x, y, 0));
    element.dispatchEvent(mouseEvent("mousemove", x, y, 0));

    await wait(randomBetween(25, 70));
  }

  return true;
}

export async function humanClick(element, { shouldStop = () => false } = {}) {
  if (!element || !element.isConnected) return false;

  element.scrollIntoView({ block: "center", behavior: "auto" });
  await wait(randomBetween(200, 500));
  if (shouldStop()) return false;

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const targetX = rect.left + rect.width * randomBetween(0.3, 0.7);
  const targetY = rect.top + rect.height * randomBetween(0.3, 0.7);
  const startX = targetX + randomBetween(-90, 90);
  const startY = targetY + randomBetween(-60, 60);

  const moved = await movePointer(
    element,
    startX,
    startY,
    targetX,
    targetY,
    shouldStop,
  );
  if (!moved) return false;

  element.focus?.();
  element.dispatchEvent(pointerEvent("pointerover", targetX, targetY, 0));
  element.dispatchEvent(mouseEvent("mouseover", targetX, targetY, 0));

  await wait(randomBetween(80, 220));
  if (shouldStop()) return false;

  element.dispatchEvent(pointerEvent("pointerdown", targetX, targetY, 1));
  element.dispatchEvent(mouseEvent("mousedown", targetX, targetY, 1));

  await wait(randomBetween(70, 180));
  if (shouldStop()) return false;

  element.dispatchEvent(pointerEvent("pointerup", targetX, targetY, 0));
  element.dispatchEvent(mouseEvent("mouseup", targetX, targetY, 0));

  await wait(randomBetween(30, 90));
  if (shouldStop()) return false;
  if (!element.isConnected || isButtonDisabled(element)) return false;

  element.click();
  return true;
}
