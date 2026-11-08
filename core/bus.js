export function createBus() {
  const listeners = new Map();

  function on(name, handler) {
    if (typeof name !== "string" || name.length === 0) {
      throw new TypeError("El nombre del evento debe ser una cadena no vacía.");
    }
    if (typeof handler !== "function") {
      throw new TypeError("El listener debe ser una función.");
    }

    let handlers = listeners.get(name);
    if (!handlers) {
      handlers = new Set();
      listeners.set(name, handlers);
    }
    handlers.add(handler);

    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) listeners.delete(name);
    };
  }

  function emit(name, payload) {
    const handlers = listeners.get(name);
    if (!handlers) return;

    for (const handler of [...handlers]) {
      try {
        handler(payload);
      } catch (error) {
        console.error(`[bus] Error en el evento "${name}":`, error);
      }
    }
  }

  return { on, emit };
}
