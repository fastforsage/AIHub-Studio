const assert = require("node:assert/strict");
const http = require("node:http");
const { app, BrowserWindow, WebContentsView, session } = require("electron");

app.disableHardwareAcceleration();

const server = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end("<!doctype html><html><head><title>AIHub Chromium Smoke</title></head><body>Chromium profile smoke test</body></html>");
});

const timeout = setTimeout(() => {
  console.error("Chromium smoke test timed out");
  app.exit(1);
}, 30000);

async function loadView(window, browserSession, url) {
  const view = new WebContentsView({
    webPreferences: {
      session: browserSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false
    }
  });
  window.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 800, height: 600 });
  view.setVisible(true);
  await view.webContents.loadURL(url);
  return view;
}

function closeView(window, view) {
  try {
    window.contentView.removeChildView(view);
  } catch {
    // The view may already have been detached by Electron during shutdown.
  }
  if (!view.webContents.isDestroyed()) view.webContents.close();
}

async function run() {
  await app.whenReady();

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object", "HTTP smoke server did not bind");
  const url = "http://127.0.0.1:" + address.port + "/";

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  const persistentPartition = "persist:aihub-smoke-" + process.pid;
  const isolatedPartition = "persist:aihub-smoke-isolated-" + process.pid;
  const persistentSession = session.fromPartition(persistentPartition);
  const isolatedSession = session.fromPartition(isolatedPartition);

  persistentSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  persistentSession.setPermissionCheckHandler(() => false);

  const firstView = await loadView(window, persistentSession, url);
  assert.equal(await firstView.webContents.getTitle(), "AIHub Chromium Smoke");
  const pageText = await firstView.webContents.executeJavaScript("document.body.textContent");
  assert.match(pageText, /Chromium profile smoke test/);

  await firstView.webContents.executeJavaScript(
    'document.cookie = "aihubSmoke=persistent; path=/; SameSite=Lax"'
  );

  const sameProfileView = await loadView(window, persistentSession, url);
  const sameProfileCookie = await sameProfileView.webContents.executeJavaScript("document.cookie");
  assert.match(sameProfileCookie, /aihubSmoke=persistent/);

  const isolatedView = await loadView(window, isolatedSession, url);
  const isolatedCookie = await isolatedView.webContents.executeJavaScript("document.cookie");
  assert.doesNotMatch(isolatedCookie, /aihubSmoke=persistent/);

  closeView(window, firstView);
  closeView(window, sameProfileView);
  closeView(window, isolatedView);
  window.destroy();

  await persistentSession.clearStorageData();
  await isolatedSession.clearStorageData();

  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });

  console.log("Chromium WebContentsView smoke test passed: page load, persistent cookies and profile isolation.");
}

run().then(() => {
  clearTimeout(timeout);
  app.quit();
}).catch((error) => {
  clearTimeout(timeout);
  console.error("Chromium WebContentsView smoke test failed:", error);
  app.exit(1);
}).finally(() => {
  if (server.listening) server.close();
});
