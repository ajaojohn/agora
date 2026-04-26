// Main process entry. Owns app lifecycle and the BrowserWindow.
// Preload, IPC, and PTY ownership land in later commits.
import { app, BrowserWindow } from 'electron';
import { join } from 'path';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // electron-vite sets ELECTRON_RENDERER_URL in dev so HMR works against the Vite dev server.
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Mac convention: clicking the dock icon with no windows open re-opens one.
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
