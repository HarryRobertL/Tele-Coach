import { BrowserWindow } from "electron";
import path from "node:path";

export function createSettingsWindow(rendererUrl: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 900,
    height: 680,
    show: false,
    frame: true,
    autoHideMenuBar: true,
    title: "Tele Coach Settings",
    webPreferences: {
      preload: path.resolve(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  void window.loadURL(`${rendererUrl}#settings`);
  return window;
}
