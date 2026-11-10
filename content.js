(() => {
  const FLAG = "__extContentLoaded";
  if (globalThis[FLAG]) return;
  globalThis[FLAG] = true;

  async function run() {
    const config = await import(chrome.runtime.getURL("core/config.js"));
    if (!config.isTargetUrl(location.href)) return;

    const [
      busModule,
      registryModule,
      storage,
      urlModule,
      sessionModule,
      logModule,
      moduleIndex,
    ] = await Promise.all([
      import(chrome.runtime.getURL("core/bus.js")),
      import(chrome.runtime.getURL("core/registry.js")),
      import(chrome.runtime.getURL("core/storage.js")),
      import(chrome.runtime.getURL("core/url.js")),
      import(chrome.runtime.getURL("core/session.js")),
      import(chrome.runtime.getURL("core/log.js")),
      import(chrome.runtime.getURL("modules/index.js")),
    ]);

    await logModule.initLogger();

    // Si la extensión se recarga con la pestaña abierta, el contexto del
    // content script queda invalidado (chrome.runtime deja de existir) y
    // cualquier llamada a chrome.* lanza TypeError. En ese estado no se
    // reintenta nada: el content script se detiene en silencio en lugar de
    // llenar la consola de errores.
    function runtimeAvailable() {
      if (runtimeDead) return false;

      try {
        return (
          typeof globalThis.chrome !== "undefined" &&
          typeof globalThis.chrome.runtime?.sendMessage === "function"
        );
      } catch {
        return false;
      }
    }

    function isInvalidatedError(error) {
      const message = error?.message ?? String(error);
      return /extension context invalidated|cannot read properties of undefined \(reading '(sendMessage|storage|runtime|onMessage|tabs|scripting|alarms|local|sync|id)'\)/i.test(
        message,
      );
    }

    // Deben existir antes de connectKeepAlive(): runtimeAvailable() los lee.
    let runtimeDead = false;
    let stopped = false;

    // Keep-alive: un puerto de larga duración mantiene despierto al service
    // worker mientras este content script esté vivo. Reconecta si se cierra.
    let keepAlivePort = null;
    let keepAliveRetries = 0;

    function connectKeepAlive() {
      if (!runtimeAvailable()) return;

      const retryDelay = Math.min(1000 * (keepAliveRetries + 1), 5000);

      try {
        keepAlivePort = chrome.runtime.connect({ name: "keepalive" });
        keepAliveRetries = 0;

        keepAlivePort.onDisconnect.addListener(() => {
          keepAlivePort = null;
          keepAliveRetries += 1;
          window.setTimeout(connectKeepAlive, retryDelay);
        });
      } catch {
        keepAlivePort = null;
        keepAliveRetries += 1;
        window.setTimeout(connectKeepAlive, retryDelay);
      }
    }

    connectKeepAlive();

    // Diagnóstico (solo con debug): mide cuánto se retrasan los timers de la
    // pestaña. Sirve para comprobar en el navegador real si Chrome la frena
    // (sin flags, oculta >5 min: retrasos de decenas de segundos).
    function startThrottleProbe() {
      if (!logModule.isDebugEnabled()) return;

      const STEP_MS = 1000;
      const REPORT_MS = 60000;
      let expected = Date.now() + STEP_MS;
      let maxLateMs = 0;
      let lastReport = Date.now();
      let hiddenSince = document.hidden ? Date.now() : null;

      document.addEventListener("visibilitychange", () => {
        hiddenSince = document.hidden ? Date.now() : null;
      });

      const tick = () => {
        if (stopped) return;

        const now = Date.now();
        maxLateMs = Math.max(maxLateMs, now - expected);

        if (now - lastReport >= REPORT_MS) {
          const hiddenMinutes = hiddenSince
            ? ((now - hiddenSince) / 60000).toFixed(1)
            : "0";
          logModule.log(
            `Timers: oculta ${document.hidden ? "sí" : "no"} (${hiddenMinutes} min), retraso máximo ${maxLateMs} ms.`,
          );
          maxLateMs = 0;
          lastReport = now;
        }

        expected = now + STEP_MS;
        window.setTimeout(tick, STEP_MS);
      };

      window.setTimeout(tick, STEP_MS);
    }

    startThrottleProbe();

    const modules = Array.isArray(moduleIndex.modules)
      ? moduleIndex.modules
      : [];
    const contentModules = modules.filter(
      (definition) =>
        definition &&
        typeof definition.id === "string" &&
        definition.id.length > 0 &&
        definition.hasContent !== false,
    );
    const bus = busModule.createBus();
    let states = {};
    let statesLoaded = false;
    let cssFailureCount = 0;
    let nextCssAttemptAt = 0;
    let currentUrl = location.href;
    let pending = false;
    let queue = Promise.resolve();
    let refreshToken = 0;
    let urlInterval = null;
    let cssInterval = null;
    let aliveInterval = null;
    let unwatchModuleStates = null;

    function markRuntimeDead() {
      if (runtimeDead) return;
      runtimeDead = true;
      stopIfDead(true);
    }

    const registry = registryModule.createRegistry({
      load: (id) => import(chrome.runtime.getURL(`modules/${id}/content.js`)),
      createContext: (id) => ({
        id,
        bus,
        storage,
        getSettings: async () => {
          if (!runtimeAvailable()) {
            markRuntimeDead();
            return {};
          }

          try {
            const next = await storage.getModuleStates(modules);
            return next[id]?.settings ?? {};
          } catch (error) {
            if (isInvalidatedError(error)) {
              markRuntimeDead();
              return {};
            }

            throw error;
          }
        },
        log: (...args) => {
          if (runtimeDead || stopped) return;
          logModule.log(`[${id}]`, ...args);
        },
      }),
      onError: (error, id) => {
        if (!runtimeAvailable() || isInvalidatedError(error)) {
          markRuntimeDead();
          return;
        }

        logModule.warn(`Módulo "${id}" en la página:`, error);
      },
    });

    const sessionWatcher = sessionModule.startSessionWatcher({
      shouldCheck: () => config.isTargetPage(location.href),
      onChange: () => {
        refreshStates()
          .then(scheduleSync)
          .then(ensureCssState)
          .catch((error) => {
            if (!runtimeAvailable() || isInvalidatedError(error)) {
              markRuntimeDead();
              return;
            }
            logModule.warn("No se pudo actualizar la sesión:", error);
          });
      },
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "css:error") {
        logModule.warn("No se pudo insertar CSS:", message.detail);
      }
    });

    async function refreshStates() {
      if (!runtimeAvailable()) {
        markRuntimeDead();
        return;
      }

      try {
        const token = ++refreshToken;
        const [rawStates, session] = await Promise.all([
          storage.getModuleStates(modules),
          sessionModule.getSessionState(location.origin),
        ]);
        const nextStates = sessionModule.applySessionGate(
          modules,
          rawStates,
          session,
        );

        if (token === refreshToken) {
          states = nextStates;
          statesLoaded = true;
        }
      } catch (error) {
        if (isInvalidatedError(error)) {
          markRuntimeDead();
          return;
        }

        throw error;
      }
    }

    function isCleanViewApplied() {
      const header = document.querySelector("header[data-cabecera-sitio]");
      const footer = document.querySelector("footer");
      if (!header || !footer) return null;

      return (
        getComputedStyle(header).display === "none" &&
        getComputedStyle(footer).display === "none"
      );
    }

    async function requestCssEnsure() {
      if (!runtimeAvailable()) return false;

      try {
        const response = await chrome.runtime.sendMessage({
          type: "css:ensure",
        });
        return response?.ok === true;
      } catch (error) {
        if (!runtimeAvailable() || isInvalidatedError(error)) {
          markRuntimeDead();
          return false;
        }

        logModule.warn("No se pudo confirmar el CSS:", error);
        return false;
      }
    }

    // Backoff 1 s, 2 s, 4 s… con techo: un fallo transitorio del background
    // no mata la función. Se reintenta para siempre mientras el estado
    // deseado siga sin aplicarse; al aplicar, el contador se resetea.
    function backoffDelay(failures) {
      return Math.min(1000 * 2 ** Math.max(0, failures - 1), 8000);
    }

    async function ensureCssState() {
      if (stopped) return;

      if (!runtimeAvailable()) {
        stopIfDead();
        return;
      }

      if (!statesLoaded || !config.isTargetPage(location.href)) return;

      const applied = isCleanViewApplied();
      if (applied === null) return;

      const desired = states["vista-limpia"]?.enabled === true;

      if (applied === desired) {
        cssFailureCount = 0;
        return;
      }

      if (!desired) {
        await requestCssEnsure();
        return;
      }

      const now = Date.now();
      if (now < nextCssAttemptAt) return;

      if (cssFailureCount === 0) {
        logModule.log(
          "Vista limpia no coincide (deseada: true, aplicada: false); comprobando CSS.",
        );
      }

      const confirmed = await requestCssEnsure();
      await new Promise((resolve) => window.setTimeout(resolve, 200));

      if (isCleanViewApplied() === true) {
        cssFailureCount = 0;
        return;
      }

      cssFailureCount += 1;
      const waitMs = backoffDelay(cssFailureCount);
      nextCssAttemptAt = Date.now() + waitMs;

      logModule.log(
        `CSS no aplicado${confirmed ? " tras confirmación" : ""}; reintento ${cssFailureCount} en ${waitMs} ms.`,
      );
    }

    function desiredIds() {
      return contentModules
        .filter((definition) => states[definition.id]?.enabled === true)
        .filter((definition) =>
          urlModule.matchesTarget(location.href, definition.matches),
        )
        .map((definition) => definition.id);
    }

    async function runSync() {
      if (!pending || stopped) return;
      if (!runtimeAvailable()) {
        stopIfDead();
        return;
      }

      pending = false;

      try {
        await registry.sync(desiredIds());
      } finally {
        if (pending) {
          await runSync();
        }
      }
    }

    function scheduleSync() {
      if (stopped) return;

      if (!runtimeAvailable()) {
        stopIfDead();
        return;
      }

      pending = true;
      queue = queue.then(runSync).catch((error) => {
        if (!runtimeAvailable() || isInvalidatedError(error)) {
          markRuntimeDead();
          return;
        }
        logModule.warn("No se pudo sincronizar la página:", error);
      });
    }

    function handleUrlChange() {
      if (stopped) return;

      if (!runtimeAvailable()) {
        stopIfDead();
        return;
      }

      if (location.href === currentUrl) return;
      currentUrl = location.href;
      void sessionWatcher.check();
      scheduleSync();
      void ensureCssState();
    }

    async function probeRuntime() {
      if (stopped || runtimeDead) return;

      try {
        await chrome.runtime.sendMessage({ type: "ping" });
      } catch (error) {
        // Solo una invalidación real detiene el content script; un background
        // dormido o reiniciándose no debe matar la vista limpia.
        if (isInvalidatedError(error)) markRuntimeDead();
      }
    }

    function stopIfDead(force = false) {
      if (!force && runtimeAvailable()) return false;
      if (stopped) return true;

      // Contexto invalidado (extensión recargada): parar todo en silencio.
      stopped = true;
      pending = false;

      if (urlInterval !== null) window.clearInterval(urlInterval);
      if (cssInterval !== null) window.clearInterval(cssInterval);
      if (aliveInterval !== null) window.clearInterval(aliveInterval);
      urlInterval = null;
      cssInterval = null;
      aliveInterval = null;

      try {
        sessionWatcher.destroy();
      } catch {}

      try {
        unwatchModuleStates?.();
      } catch {}

      // Desmonta los módulos (quita observers y listeners) sin tocar chrome.*
      // desde el contexto ya invalidado.
      void registry.sync([]).catch(() => {});

      if (keepAlivePort) {
        try {
          keepAlivePort.disconnect();
        } catch {}
        keepAlivePort = null;
      }

      return true;
    }

    urlInterval = window.setInterval(() => {
      if (stopIfDead()) return;
      handleUrlChange();
    }, 500);

    cssInterval = window.setInterval(() => {
      if (stopIfDead()) return;
      void ensureCssState();
    }, 2000);

    aliveInterval = window.setInterval(() => {
      if (stopped) return;
      void probeRuntime();
    }, 3000);

    window.addEventListener("popstate", handleUrlChange);
    window.addEventListener("hashchange", handleUrlChange);

    unwatchModuleStates = storage.watchModuleStates(() => {
      if (stopped) return;

      refreshStates()
        .then(scheduleSync)
        .then(ensureCssState)
        .catch((error) => {
          if (!runtimeAvailable() || isInvalidatedError(error)) {
            markRuntimeDead();
            return;
          }
          logModule.warn(
            "No se pudo leer la configuración de módulos:",
            error,
          );
        });
    });

    await sessionWatcher.ready.catch(() => {});
    await refreshStates();
    currentUrl = location.href;
    scheduleSync();
    void ensureCssState();
  }

  run().catch((error) => {
    const message = error?.message ?? String(error);

    // Contexto invalidado (extensión recargada/actualizada): silencio total.
    if (/extension context invalidated|cannot read properties of undefined \(reading '(sendMessage|storage|runtime|onMessage|tabs|scripting|alarms|local|sync|id)'\)/i.test(message)) {
      return;
    }

    // Sin stack: el stack delata el ID de la extensión y rutas internas.
    console.error("Extension:", message);
  });
})();
