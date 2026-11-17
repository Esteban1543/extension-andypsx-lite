import {
  humanClick,
  isButtonDisabled,
  randomBetween,
  trustedHumanClick,
  waitForRaffleDelay,
} from "../../core/actions.js";

const RAFFLE_SELECTOR = 'section[aria-label^="Raffle:"]';
const SCAN_DELAY_MS = 150;
// Techo de frecuencia: pase lo que pase en la página, nunca dos escaneos
// seguidos en menos de este intervalo. Los raffles ya procesados mutan sin
// parar (contadores, "Sorteando", listas, animaciones) y reaccionar a cada
// cambio mantenía la CPU al 100%.
const SCAN_MIN_INTERVAL_MS = 1000;
const SCAN_REPORT_MS = 60000;
const FIRST_CLICK_DELAY_MS = { min: 5000, max: 10000 };
const NEXT_CLICK_DELAY_MS = { min: 2000, max: 5000 };

let activeState = null;

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function textOf(element) {
  return normalizeText(element?.textContent);
}

function readTitle(section) {
  const label = normalizeText(section.getAttribute("aria-label"));
  const prefix = "Raffle:";

  if (label.startsWith(prefix)) {
    const title = normalizeText(label.slice(prefix.length));
    if (title) return title;
  }

  const heading = section.querySelector("h2");
  const titleContainer = heading?.nextElementSibling;
  return textOf(titleContainer?.querySelector("span")) || textOf(heading) || null;
}

function readSubtitle(section) {
  const heading = section.querySelector("h2");
  const titleContainer = heading?.nextElementSibling;
  const spans = titleContainer ? [...titleContainer.querySelectorAll("span")] : [];
  return spans.length > 1 ? textOf(spans[1]) || null : null;
}

function readRequirements(section) {
  return [...section.querySelectorAll('ul[aria-label="Requisitos"] li')]
    .map(textOf)
    .filter(Boolean);
}

function readStat(section, label) {
  for (const span of section.querySelectorAll("span")) {
    if (textOf(span) === label) {
      return textOf(span.nextElementSibling) || null;
    }
  }

  return null;
}

function findJoinButton(section) {
  const submit = section.querySelector('form button[type="submit"]');
  if (submit) return submit;

  const candidate = [...section.querySelectorAll("button")].find((button) =>
    /particip/i.test(textOf(button)),
  );

  return candidate ?? null;
}

function findPasswordInput(section) {
  return (
    section.querySelector('input[aria-label="Contraseña del raffle"]') ??
    section.querySelector('form input[type="password"]')
  );
}

function readAction(section) {
  const button = findJoinButton(section);
  if (!button) return null;

  return {
    label: textOf(button) || null,
    disabled: isButtonDisabled(button),
  };
}

function readStatus(section) {
  return textOf(section.querySelector('[role="status"]')) || null;
}

function looksAlreadyParticipating(section) {
  const status = readStatus(section)?.toLowerCase() ?? "";
  const label = readAction(section)?.label?.toLowerCase() ?? "";

  return [status, label].some(
    (text) =>
      text.includes("ya particip") ||
      text.includes("has particip") ||
      text.includes("participando") ||
      text.includes("participaste"),
  );
}

function readRaffle(section, id) {
  return {
    id,
    title: readTitle(section),
    subtitle: readSubtitle(section),
    requirements: readRequirements(section),
    participants: readStat(section, "Participantes"),
    closesIn: readStat(section, "Cierre en"),
    action: readAction(section),
    passwordRequired: Boolean(findPasswordInput(section)),
    status: readStatus(section),
  };
}

function isRaffleRelated(node) {
  if (!node || node.nodeType !== 1) return false;
  if (node.matches?.(RAFFLE_SELECTOR)) return true;
  if (node.querySelector?.(RAFFLE_SELECTOR)) return true;
  return Boolean(node.closest?.(RAFFLE_SELECTOR));
}

function formatSeconds(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function nextClickDelay(batchHasClick) {
  const range = batchHasClick ? NEXT_CLICK_DELAY_MS : FIRST_CLICK_DELAY_MS;
  return randomBetween(range.min, range.max);
}

export function init(ctx) {
  const moduleState = {
    observer: null,
    guardObserver: null,
    observedAside: null,
    scanTimer: null,
    nextScanAt: null,
    lastScanAt: 0,
    scanCount: 0,
    scanReportAt: 0,
    scanListener: null,
    tracked: new Map(),
    records: new WeakMap(),
    nextId: 1,
    initialized: false,
    queue: [],
    queued: new WeakSet(),
    processed: new WeakSet(),
    processing: false,
    stopped: false,
    batchHasClick: false,
  };

  activeState = moduleState;

  function recordFor(section) {
    let record = moduleState.records.get(section);

    if (!record) {
      record = {
        id: `r${moduleState.nextId}`,
        delayMs: null,
        clicked: false,
        skipped: null,
      };
      moduleState.nextId += 1;
      moduleState.records.set(section, record);
    }

    return record;
  }

  function markSkipped(section, reason) {
    recordFor(section).skipped = reason;
  }

  function enqueue(section) {
    if (moduleState.stopped) return;
    if (moduleState.processed.has(section) || moduleState.queued.has(section)) return;

    if (!moduleState.processing && moduleState.queue.length === 0) {
      moduleState.batchHasClick = false;
    }

    moduleState.queued.add(section);
    moduleState.queue.push(section);
    void processQueue();
  }

  async function waitAndClick(section, button, title) {
    const record = recordFor(section);
    const delayMs = nextClickDelay(moduleState.batchHasClick);
    record.delayMs = Math.round(delayMs);
    ctx.log(`Esperando ${formatSeconds(delayMs)} antes de participar:`, title);

    await waitForRaffleDelay(delayMs);
    if (moduleState.stopped) return false;

    if (!button.isConnected) {
      markSkipped(section, "no-button");
      ctx.log("Raffle omitido, botón retirado:", title);
      return false;
    }

    if (isButtonDisabled(button)) {
      markSkipped(section, "button-disabled");
      ctx.log("Raffle omitido, botón deshabilitado tras la espera:", title);
      return false;
    }

    // Se lee en el momento del clic: cambiar el ajuste en el popup aplica al
    // raffle siguiente sin reiniciar el módulo.
    const settings = await ctx.getSettings();
    const trustedClicks = settings?.trustedClicks === true;

    let clicked = false;
    let usedTrusted = trustedClicks;
    let fallbackReason = null;

    if (!trustedClicks) {
      clicked = await humanClick(button, {
        shouldStop: () => moduleState.stopped,
      });
    } else {
      const result = await trustedHumanClick(button, {
        shouldStop: () => moduleState.stopped,
      });

      if (result.ok) {
        clicked = true;
      } else if (moduleState.stopped || result.reason === "stopped") {
        return false;
      } else if (result.reason === "gone") {
        if (!button.isConnected) {
          markSkipped(section, "no-button");
          ctx.log("Raffle omitido, botón retirado durante el clic:", title);
        } else {
          markSkipped(section, "button-disabled");
          ctx.log("Raffle omitido, botón deshabilitado durante el clic:", title);
        }
        return false;
      } else if (result.reason === "missed" && looksAlreadyParticipating(section)) {
        // El clic confiable llegó pero el listener no lo vio: el sitio ya
        // registra participación, no se pulsa otra vez.
        clicked = true;
      } else if (
        button.isConnected &&
        !isButtonDisabled(button) &&
        !looksAlreadyParticipating(section)
      ) {
        // D2/D3: respaldo con clic sintético para no perder el raffle.
        const synthetic = await humanClick(button, {
          shouldStop: () => moduleState.stopped,
        });

        if (synthetic) {
          clicked = true;
          usedTrusted = false;
          fallbackReason = result.reason;
        }
      }

      if (!clicked) {
        markSkipped(section, "not-clickable");
        ctx.log(`Clic confiable falló (${result.reason}):`, title);
        return false;
      }
    }

    if (moduleState.stopped) return false;

    moduleState.batchHasClick = true;
    record.clicked = true;
    ctx.log("Clic en Participar:", title);

    if (fallbackReason) {
      ctx.log(`Clic confiable no disponible (${fallbackReason}); clic normal usado:`, title);
    }

    ctx.bus.emit("raffles:clicked", {
      id: record.id,
      title,
      at: Date.now(),
      delayMs: Math.round(delayMs),
      trusted: usedTrusted,
      ...(fallbackReason ? { fallback: fallbackReason } : {}),
    });

    return true;
  }

  async function processRaffle(section) {
    const title = readTitle(section);

    if (looksAlreadyParticipating(section)) {
      markSkipped(section, "already");
      ctx.log("Raffle ya participado:", title);
      return false;
    }

    if (findPasswordInput(section)) {
      markSkipped(section, "password-required");
      ctx.log("Raffle omitido, requiere contraseña:", title);
      return false;
    }

    const button = findJoinButton(section);
    if (!button) {
      markSkipped(section, "no-button");
      ctx.log("Raffle omitido, sin botón Participar:", title);
      return false;
    }

    if (isButtonDisabled(button)) {
      markSkipped(section, "button-disabled");
      ctx.log("Raffle omitido, botón deshabilitado:", title);
      return false;
    }

    return waitAndClick(section, button, title);
  }

  async function processQueue() {
    if (moduleState.processing || moduleState.stopped) return;
    moduleState.processing = true;

    try {
      while (moduleState.queue.length > 0 && !moduleState.stopped) {
        const section = moduleState.queue.shift();
        moduleState.queued.delete(section);

        if (!section.isConnected || moduleState.processed.has(section)) continue;

        moduleState.processed.add(section);

        try {
          await processRaffle(section);
        } catch (error) {
          if (!moduleState.stopped) {
            markSkipped(section, "error");
            ctx.log("Error al procesar raffle:", readTitle(section), error);
          }
        }
      }
    } finally {
      moduleState.processing = false;
    }
  }

  function scan() {
    const now = Date.now();
    moduleState.lastScanAt = now;
    moduleState.scanCount += 1;

    if (now - moduleState.scanReportAt >= SCAN_REPORT_MS) {
      if (moduleState.scanReportAt > 0) {
        ctx.log(`Escaneos en el último minuto: ${moduleState.scanCount}.`);
      }
      moduleState.scanCount = 0;
      moduleState.scanReportAt = now;
    }

    const sections = [...document.querySelectorAll(RAFFLE_SELECTOR)];
    const currentSections = new Map();

    for (const section of sections) {
      const record = recordFor(section);
      const known = moduleState.tracked.get(section);

      // Raffle ya procesado: se reutiliza el snapshot anterior. Sus cambios
      // internos (contadores, listas, animaciones) no vuelven a leer el DOM,
      // que era la parte cara de cada escaneo.
      const snapshot =
        known && moduleState.processed.has(section)
          ? known
          : readRaffle(section, record.id);
      currentSections.set(section, snapshot);
    }

    const added = [];
    for (const [section, snapshot] of currentSections) {
      if (!moduleState.tracked.has(section)) added.push(snapshot);
    }

    const removed = [];
    for (const [section, snapshot] of moduleState.tracked) {
      if (!currentSections.has(section)) {
        removed.push(snapshot);
      }
    }

    moduleState.tracked = currentSections;
    const raffles = [...currentSections.values()];

    ctx.bus.emit("raffles:snapshot", { count: raffles.length, raffles });

    if (!moduleState.initialized) {
      moduleState.initialized = true;
      ctx.log(
        raffles.length
          ? `Raffles activos: ${raffles.length}.`
          : "No hay raffles activos.",
      );

      for (const raffle of raffles) {
        ctx.log("Detectado:", raffle.title);
      }
    } else {
      for (const raffle of added) {
        ctx.log("Raffle detectado:", raffle.title);
      }

      for (const raffle of removed) {
        ctx.log("Raffle retirado:", raffle.title);
      }
    }

    for (const section of currentSections.keys()) {
      enqueue(section);
    }
  }

  function scheduleScan() {
    if (moduleState.stopped) return;

    // Se agrupan las mutaciones (SCAN_DELAY_MS) y además se impone un mínimo
    // entre escaneos: una ráfaga de cambios no puede disparar escaneo tras
    // escaneo. Con la pestaña oculta Chrome agrupa los timers en 1/s, que ya
    // encaja con este techo; el latido "scan" del background cubre los huecos.
    const now = Date.now();
    const at = Math.max(
      now + SCAN_DELAY_MS,
      moduleState.lastScanAt + SCAN_MIN_INTERVAL_MS,
    );

    if (
      moduleState.scanTimer !== null &&
      moduleState.nextScanAt !== null &&
      moduleState.nextScanAt <= at
    ) {
      return;
    }

    window.clearTimeout(moduleState.scanTimer);
    moduleState.nextScanAt = at;
    moduleState.scanTimer = window.setTimeout(() => {
      moduleState.scanTimer = null;
      moduleState.nextScanAt = null;
      if (!moduleState.stopped) scan();
    }, at - now);
  }

  function handleMutations(mutations) {
    const relevant = mutations.some((mutation) => {
      for (const node of mutation.addedNodes) {
        if (isRaffleRelated(node)) return true;
      }
      for (const node of mutation.removedNodes) {
        if (isRaffleRelated(node)) return true;
      }

      // Cambios DENTRO de una tarjeta: solo importan en raffles aún no
      // procesados, donde el botón puede aparecer o habilitarse. En los ya
      // procesados (clic hecho u omitido definitivo) el contenido cambia sin
      // parar y reaccionar era la principal fuente de CPU.
      const section = mutation.target?.closest?.(RAFFLE_SELECTOR);
      return Boolean(section) && !moduleState.processed.has(section);
    });

    if (relevant) scheduleScan();
  }

  // Detección: observer sobre el aside de participación, no sobre el body.
  // Ahorra pasar cada mutación de la página (chat, contadores, feed) por el
  // filtro de raffles.
  function attachAsideObserver() {
    const aside = document.querySelector(
      'aside[aria-label="Participa en el directo"]',
    );

    if (!aside || moduleState.observedAside === aside) return Boolean(aside);

    if (moduleState.observedAside?.isConnected) {
      moduleState.observer.disconnect();
    }
    moduleState.observedAside = aside;
    moduleState.observer.observe(aside, { childList: true, subtree: true });
    return true;
  }

  // Red de seguridad: si React reemplaza el aside, el observer viejo queda
  // mirando un nodo huérfano. Este guard barato del body (O(1) por lote) lo
  // detecta y reengancha al aside nuevo.
  function handleGuardMutations() {
    if (moduleState.observedAside?.isConnected) return;
    if (attachAsideObserver()) scan();
  }

  moduleState.observer = new MutationObserver(handleMutations);
  moduleState.guardObserver = new MutationObserver(handleGuardMutations);

  const root = document.body ?? document.documentElement;
  if (root) {
    moduleState.guardObserver.observe(root, { childList: true, subtree: true });
  }
  attachAsideObserver();

  // Latido de escaneo por alarma del background: refuerzo al observer para que
  // la detección siga siendo regular con la pestaña en segundo plano.
  function handleScanRequest(message, sender, sendResponse) {
    if (message?.type !== "scan:request") return false;

    if (moduleState.stopped) {
      sendResponse({ ok: false, stopped: true });
      return false;
    }

    scan();
    sendResponse({ ok: true, count: moduleState.tracked.size });
    return false;
  }

  try {
    chrome.runtime?.onMessage?.addListener?.(handleScanRequest);
    moduleState.scanListener = handleScanRequest;
  } catch {
    // Contexto invalidado: el content script se detendrá en el próximo tick.
    moduleState.scanListener = null;
  }

  scan();
}

export function destroy() {
  const moduleState = activeState;
  if (!moduleState) return;

  moduleState.stopped = true;
  moduleState.queue.length = 0;
  moduleState.observer?.disconnect();
  moduleState.guardObserver?.disconnect();
  window.clearTimeout(moduleState.scanTimer);

  if (moduleState.scanListener) {
    try {
      chrome.runtime?.onMessage?.removeListener?.(moduleState.scanListener);
    } catch {
      // Contexto ya invalidado: no hay listener que quitar.
    }
  }

  activeState = null;
}
