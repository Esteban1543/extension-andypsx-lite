import {
  humanClick,
  isButtonDisabled,
  randomBetween,
  wait,
} from "../../core/actions.js";

const RAFFLE_SELECTOR = 'section[aria-label^="Raffle:"]';
const SCAN_DELAY_MS = 150;
const FIRST_CLICK_DELAY_MS = { min: 5000, max: 10000 };
const NEXT_CLICK_DELAY_MS = { min: 2000, max: 5000 };

const ATTR_RAFFLE = "data-andypsx-raffle";
const ATTR_DELAY = "data-andypsx-raffle-delay-ms";
const ATTR_CLICKED = "data-andypsx-raffle-clicked";
const ATTR_SKIPPED = "data-andypsx-raffle-skipped";

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
    scanTimer: null,
    tracked: new Map(),
    ids: new WeakMap(),
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

  function idFor(section) {
    let id = moduleState.ids.get(section);

    if (!id) {
      id = `raffle-${moduleState.nextId}`;
      moduleState.nextId += 1;
      moduleState.ids.set(section, id);
    }

    return id;
  }

  function markSkipped(section, reason) {
    section.setAttribute(ATTR_SKIPPED, reason);
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
    const delayMs = nextClickDelay(moduleState.batchHasClick);
    section.setAttribute(ATTR_DELAY, String(Math.round(delayMs)));
    ctx.log(`Esperando ${formatSeconds(delayMs)} antes de participar:`, title);

    await wait(delayMs);
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

    const clicked = await humanClick(button, {
      shouldStop: () => moduleState.stopped,
    });

    if (!clicked || moduleState.stopped) {
      if (!moduleState.stopped) markSkipped(section, "not-clickable");
      return false;
    }

    moduleState.batchHasClick = true;
    section.setAttribute(ATTR_CLICKED, "true");
    ctx.log("Clic humano en Participar:", title);
    ctx.bus.emit("raffles:clicked", {
      id: idFor(section),
      title,
      at: Date.now(),
      delayMs: Math.round(delayMs),
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
    const sections = [...document.querySelectorAll(RAFFLE_SELECTOR)];
    const currentSections = new Map();

    for (const section of sections) {
      const snapshot = readRaffle(section, idFor(section));
      currentSections.set(section, snapshot);
      section.setAttribute(ATTR_RAFFLE, snapshot.id);
    }

    const added = [];
    for (const [section, snapshot] of currentSections) {
      if (!moduleState.tracked.has(section)) added.push(snapshot);
    }

    const removed = [];
    for (const [section, snapshot] of moduleState.tracked) {
      if (!currentSections.has(section)) {
        removed.push(snapshot);
        section.removeAttribute(ATTR_RAFFLE);
        section.removeAttribute(ATTR_DELAY);
        section.removeAttribute(ATTR_CLICKED);
        section.removeAttribute(ATTR_SKIPPED);
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
    window.clearTimeout(moduleState.scanTimer);
    moduleState.scanTimer = window.setTimeout(scan, SCAN_DELAY_MS);
  }

  function handleMutations(mutations) {
    const relevant = mutations.some((mutation) => {
      if (mutation.target?.closest?.(RAFFLE_SELECTOR)) return true;

      for (const node of mutation.addedNodes) {
        if (isRaffleRelated(node)) return true;
      }
      for (const node of mutation.removedNodes) {
        if (isRaffleRelated(node)) return true;
      }

      return false;
    });

    if (relevant) scheduleScan();
  }

  moduleState.observer = new MutationObserver(handleMutations);

  const root = document.body ?? document.documentElement;
  if (root) {
    moduleState.observer.observe(root, { childList: true, subtree: true });
  }

  scan();
}

export function destroy() {
  const moduleState = activeState;
  if (!moduleState) return;

  moduleState.stopped = true;
  moduleState.queue.length = 0;
  moduleState.observer?.disconnect();
  window.clearTimeout(moduleState.scanTimer);

  for (const section of document.querySelectorAll(
    `[${ATTR_RAFFLE}], [${ATTR_DELAY}], [${ATTR_CLICKED}], [${ATTR_SKIPPED}]`,
  )) {
    section.removeAttribute(ATTR_RAFFLE);
    section.removeAttribute(ATTR_DELAY);
    section.removeAttribute(ATTR_CLICKED);
    section.removeAttribute(ATTR_SKIPPED);
  }

  activeState = null;
}
