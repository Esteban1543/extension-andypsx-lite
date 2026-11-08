(() => {
  const FLAG = "__andypsxLiveContentCargado";
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
      moduleIndex,
    ] = await Promise.all([
      import(chrome.runtime.getURL("core/bus.js")),
      import(chrome.runtime.getURL("core/registry.js")),
      import(chrome.runtime.getURL("core/storage.js")),
      import(chrome.runtime.getURL("core/url.js")),
      import(chrome.runtime.getURL("core/session.js")),
      import(chrome.runtime.getURL("modules/index.js")),
    ]);

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
    let lastCssSyncAt = 0;
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
        log: (...args) => console.log(`[${id}]`, ...args),
      }),
      onError: (error, id) => {
        console.error(
          `[andypsx-live] Módulo "${id}" en la página:`,
          error,
        );
      },
    });

    const sessionWatcher = sessionModule.startSessionWatcher({
      shouldCheck: () => config.isTargetPage(location.href),
      onChange: () => {
        refreshStates()
          .then(scheduleSync)
          .then(ensureCssState)
          .catch((error) =>
            console.error(
              "[andypsx-live] No se pudo actualizar la sesión:",
              error,
            ),
          );
      },
    });

    async function refreshStates() {
      const token = ++refreshToken;
      const [rawStates, session] = await Promise.all([
        storage.getModuleStates(modules),
        sessionModule.getSessionState(),
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

    async function ensureCssState() {
      if (!statesLoaded || !config.isTargetPage(location.href)) return;

      const applied = isCleanViewApplied();
      if (applied === null) return;

      const desired = states["vista-limpia"]?.enabled === true;
      if (applied === desired) return;

      const now = Date.now();
      if (now - lastCssSyncAt < 2000) return;
      lastCssSyncAt = now;

      console.log(
        `[andypsx-live] Vista limpia no coincide (deseada: ${desired}, aplicada: ${applied}); resincronizando.`,
      );

      try {
        await chrome.runtime.sendMessage({ type: "modules:sync" });
      } catch (error) {
        console.debug("[andypsx-live] No se pudo pedir resync:", error);
      }
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
          console.error("[andypsx-live] No se pudo sincronizar la página:", error),
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
          console.error(
            "[andypsx-live] No se pudo leer la configuración de módulos:",
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
    console.error(
      "[andypsx-live] No se pudo iniciar el content script:",
      error,
    );
  });
})();
