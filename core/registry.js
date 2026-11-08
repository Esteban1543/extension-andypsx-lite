import { error as logError } from "./log.js";

export function createRegistry({
  load,
  createContext = () => ({}),
  onError = (error, id) => logError(`[registry] Módulo "${id}":`, error),
} = {}) {
  if (typeof load !== "function") {
    throw new TypeError("createRegistry necesita una función load.");
  }

  const active = new Map();
  let generation = 0;
  let queue = Promise.resolve();

  async function release(id, cleanup, destroy) {
    if (typeof cleanup === "function") {
      try {
        await cleanup();
      } catch (error) {
        onError(error, id);
      }
    }

    if (typeof destroy === "function") {
      try {
        await destroy();
      } catch (error) {
        onError(error, id);
      }
    }
  }

  async function unmount(id) {
    const entry = active.get(id);
    if (!entry) return;

    active.delete(id);
    await release(id, entry.cleanup, entry.destroy);
  }

  async function mount(id, token) {
    if (active.has(id)) return;

    try {
      const namespace = await load(id);
      if (token !== generation) return;

      if (typeof namespace?.init !== "function") {
        throw new Error(`El módulo "${id}" no exporta init().`);
      }

      const cleanup = await namespace.init(createContext(id));

      if (token !== generation) {
        await release(id, cleanup, namespace.destroy);
        return;
      }

      active.set(id, {
        cleanup: typeof cleanup === "function" ? cleanup : null,
        destroy: typeof namespace.destroy === "function" ? namespace.destroy : null,
      });
    } catch (error) {
      onError(error, id);
    }
  }

  async function apply(ids, token) {
    const desired = new Set(ids);

    for (const id of [...active.keys()]) {
      if (token !== generation) return;
      if (!desired.has(id)) await unmount(id);
    }

    for (const id of ids) {
      if (token !== generation) return;
      await mount(id, token);
    }
  }

  function sync(ids) {
    if (!Array.isArray(ids)) {
      return Promise.reject(new TypeError("sync necesita un array de ids."));
    }

    generation += 1;
    const token = generation;
    const next = queue.then(() => apply(ids, token)).catch((error) => onError(error));
    queue = next.catch(() => {});
    return next;
  }

  return { sync };
}
