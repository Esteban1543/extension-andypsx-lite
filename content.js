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
    let adoptedStyleSheet = null;
    let cssTextPromise = null;
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

    async function getCssText() {
      if (!cssTextPromise) {
        cssTextPromise = (async () => {
          try {
            const stored = await chrome.storage.local.get(
              config.CSS_CACHE_KEY,
            );
            const cached = stored[config.CSS_CACHE_KEY];

            if (typeof cached === "string" && cached.length > 0) {
              return cached;
            }
          } catch (error) {
            logModule.warn("No se pudo leer el CSS guardado:", error);
          }

          try {
            const response = await chrome.runtime.sendMessage({
              type: "css:text",
            });

            if (
              response?.ok === true &&
              typeof response.css === "string" &&
              response.css.length > 0
            ) {
              return response.css;
            }
          } catch (error) {
            logModule.warn("No se pudo pedir el CSS:", error);
          }

          throw new Error("CSS no disponible");
        })();
      }

      return cssTextPromise;
    }

    function removeAdoptedCss() {
      if (!adoptedStyleSheet) return;

      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
        (sheet) => sheet !== adoptedStyleSheet,
      );
      adoptedStyleSheet = null;
    }

    async function adoptCss() {
      if (
        adoptedStyleSheet &&
        document.adoptedStyleSheets.includes(adoptedStyleSheet)
      ) {
        return true;
      }

      if (
        !("adoptedStyleSheets" in document) ||
        typeof CSSStyleSheet !== "function"
      ) {
        return false;
      }

      try {
        const css = await getCssText();
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        document.adoptedStyleSheets = [
          ...document.adoptedStyleSheets,
          sheet,
        ];
        adoptedStyleSheet = sheet;
        logModule.log("Hoja de estilos adoptada aplicada.");
        return true;
      } catch (error) {
        logModule.error("No se pudo aplicar el CSS adoptado:", error);
        return false;
      }
    }

    async function requestCssEnsure() {
      try {
        const response = await chrome.runtime.sendMessage({
          type: "css:ensure",
          targetOrigin: config.TARGET_ORIGIN,
        });
        return response?.ok === true;
      } catch (error) {
        logModule.warn("No se pudo confirmar el CSS:", error);
        return false;
      }
    }

    function backoffDelay(failures) {
      return Math.min(1000 * 2 ** Math.max(0, failures - 1), 4000);
    }

    async function ensureCssState() {
      if (!statesLoaded || !config.isTargetPage(location.href)) return;

      const applied = isCleanViewApplied();
      if (applied === null) return;

      const desired = states["vista-limpia"]?.enabled === true;

      if (applied === desired) {
        cssFailureCount = 0;
        if (!desired) removeAdoptedCss();
        return;
      }

      if (!desired) {
        removeAdoptedCss();
        await requestCssEnsure();
        return;
      }

      const now = Date.now();
      if (now < nextCssAttemptAt) return;

      logModule.log(
        `Vista limpia no coincide (deseada: true, aplicada: false); comprobando CSS.`,
      );

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
        `CSS no aplicado${confirmed ? " tras confirmación" : ""}; reintento ${cssFailureCount}/3 en ${waitMs} ms.`,
      );

      if (cssFailureCount >= 3) {
        const adopted = await adoptCss();
        logModule.log(
          adopted
            ? "CSS adoptado como último recurso."
            : "No se pudo aplicar el CSS adoptado.",
        );
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
          logModule.error("No se pudo sincronizar la página:", error),
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
          logModule.error(
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
    console.error("Extension:", error);
  });
})();
