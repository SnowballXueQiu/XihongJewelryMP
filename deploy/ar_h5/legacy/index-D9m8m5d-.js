const showRecovery = (message) => {
  const root = document.getElementById("root");
  if (!root) return;

  root.innerHTML = `
    <main style="min-height:100vh;display:grid;place-items:center;padding:32px;box-sizing:border-box;background:#090909;color:#f5f2ec;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
      <div>
        <strong style="font-family:Georgia,'Times New Roman',serif;font-size:18px;font-weight:500;letter-spacing:4px">XI HONG</strong>
        <p style="margin:16px 0;color:#aaa49b;font-size:14px">${message}</p>
        <button id="legacy-ar-refresh" type="button" style="min-width:132px;padding:12px 20px;border:1px solid #b99a5d;border-radius:2px;color:#f8f5ef;background:transparent;font:inherit">刷新页面</button>
      </div>
    </main>`;

  document.getElementById("legacy-ar-refresh")?.addEventListener("click", () => {
    window.location.replace(`${window.location.pathname}?refresh=${Date.now()}`);
  });
};

const loadCurrentApplication = async () => {
  const response = await fetch(`/index.html?legacy-bootstrap=${Date.now()}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Entrypoint request failed: ${response.status}`);

  const html = await response.text();
  const currentDocument = new DOMParser().parseFromString(html, "text/html");
  const modulePath = currentDocument
    .querySelector('script[type="module"][src]')
    ?.getAttribute("src");
  if (!modulePath) throw new Error("Current module entrypoint was not found");

  currentDocument.querySelectorAll('link[rel="stylesheet"][href]').forEach((stylesheet) => {
    const href = stylesheet.getAttribute("href");
    if (!href || document.querySelector(`link[href="${href}"]`)) return;

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  });

  await import(new URL(modulePath, window.location.origin).href);
};

loadCurrentApplication().catch((error) => {
  console.error("Failed to recover the cached AR entrypoint", error);
  showRecovery("AR 试戴页面未能正常启动");
});
