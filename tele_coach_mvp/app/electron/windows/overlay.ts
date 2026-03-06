import { BrowserWindow } from "electron";
import path from "node:path";

export type OverlayMode = "compact" | "expanded";

const OVERLAY_SIZES: Record<OverlayMode, { width: number; height: number }> = {
  compact: { width: 360, height: 180 },
  expanded: { width: 520, height: 360 }
};

export interface OverlayWindowOptions {
  x?: number;
  y?: number;
  opacity?: number;
}

export function createOverlayWindow(rendererUrl: string, options?: OverlayWindowOptions): BrowserWindow {
  const initialMode: OverlayMode = "compact";
  const size = OVERLAY_SIZES[initialMode];

  const window = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: 320,
    minHeight: 160,
    alwaysOnTop: true,
    frame: false,
    transparent: false,
    movable: true,
    resizable: true,
    skipTaskbar: true,
    title: "Tele Coach Overlay",
    x: options?.x,
    y: options?.y,
    opacity: options?.opacity ?? 0.95,
    webPreferences: {
      preload: path.resolve(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  void window.loadURL(`${rendererUrl}#overlay`);
  return window;
}

export function setOverlayMode(window: BrowserWindow, mode: OverlayMode): void {
  const currentBounds = window.getBounds();
  const nextSize = OVERLAY_SIZES[mode];
  window.setBounds({
    x: currentBounds.x,
    y: currentBounds.y,
    width: nextSize.width,
    height: nextSize.height
  });
}
