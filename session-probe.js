(() => {
  const FLAG = "__extSessionProbe";
  if (globalThis[FLAG]) return;
  globalThis[FLAG] = true;

  async function run() {
    const config = await import(chrome.runtime.getURL("core/config.js"));
    if (!config.isTargetPage(location.href)) return;

    const [logModule, session] = await Promise.all([
      import(chrome.runtime.getURL("core/log.js")),
      import(chrome.runtime.getURL("core/session.js")),
    ]);

    await logModule.initLogger();

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "css:error") {
        logModule.warn("No se pudo insertar CSS:", message.detail);
      }
    });

    session.startSessionWatcher({
      shouldCheck: () => config.isTargetPage(location.href),
    });
  }

  run().catch((error) => {
    console.error("Extension:", error);
  });
})();
