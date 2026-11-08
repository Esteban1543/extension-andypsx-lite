(() => {
  const FLAG = "__andypsxLiveSessionProbe";
  if (globalThis[FLAG]) return;
  globalThis[FLAG] = true;

  async function run() {
    const config = await import(chrome.runtime.getURL("core/config.js"));
    if (!config.isTargetPage(location.href)) return;

    const session = await import(chrome.runtime.getURL("core/session.js"));
    session.startSessionWatcher({
      shouldCheck: () => config.isTargetPage(location.href),
    });
  }

  run().catch((error) => {
    console.error(
      "[andypsx-live] No se pudo iniciar session-probe:",
      error,
    );
  });
})();
