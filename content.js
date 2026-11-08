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

    const registry = registryModule.createRegistry({
      load: (id) => import(chrome.runtime.getURL(`modules/${id}/content.js`)),
      createContext: (id) => ({
        id,
        bus,
        storage,
        getSettings: async () => {
          const next = await storage.getModuleStates(modules);
          return next[id]?.settings ?? {};
        },
        log: (...args) => logModule.log(`[${id}]`, ...args),
      }),
      onError: (error, id) => {
        logModule.warn(`Módulo "${id}" en la página:`, error);
      },
    });

    const sessionWatcher = sessionModule.startSessionWatcher({
      shouldCheck: () => config.isTargetPage(location.href),
      onChange: () => {
        refreshStates()
          .then(scheduleSync)
          .then(ensureCssState)
          .catch((error) =>
            logModule.warn("No se pudo actualizar la sesión:", error),
          );
      },
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "css:error") {
        logModule.warn("No se pudo insertar CSS:", message.detail);
      }
    });

    async function refreshStates() {
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
      try {
        const response = await chrome.runtime.sendMessage({
          type: "css:ensure",
        });
        return response?.ok === true;
      } catch (error) {
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
      if (!pending) return;
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
      pending = true;
      queue = queue
        .then(runSync)
        .catch((error) =>
          logModule.warn("No se pudo sincronizar la página:", error),
        );
    }

    function handleUrlChange() {
      if (location.href === currentUrl) return;
      currentUrl = location.href;
      void sessionWatcher.check();
      scheduleSync();
      void ensureCssState();
    }

    window.addEventListener("popstate", handleUrlChange);
    window.addEventListener("hashchange", handleUrlChange);
    window.setInterval(handleUrlChange, 500);
    window.setInterval(() => {
      void ensureCssState();
    }, 2000);

    storage.watchModuleStates(() => {
      refreshStates()
        .then(scheduleSync)
        .then(ensureCssState)
        .catch((error) =>
          logModule.warn(
            "No se pudo leer la configuración de módulos:",
            error,
          ),
        );
    });

    await sessionWatcher.ready.catch(() => {});
    await refreshStates();
    currentUrl = location.href;
    scheduleSync();
    void ensureCssState();
  }

  run().catch((error) => {
    // Sin stack: el stack delata el ID de la extensión y rutas internas.
    console.error("Extension:", error?.message ?? String(error));
  });
})();
