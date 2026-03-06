"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOverlayWindow = createOverlayWindow;
exports.setOverlayMode = setOverlayMode;
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const OVERLAY_SIZES = {
    compact: { width: 360, height: 180 },
    expanded: { width: 520, height: 360 }
};
function createOverlayWindow(rendererUrl, options) {
    const initialMode = "compact";
    const size = OVERLAY_SIZES[initialMode];
    const window = new electron_1.BrowserWindow({
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
            preload: node_path_1.default.resolve(__dirname, "../preload.js"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    void window.loadURL(`${rendererUrl}#overlay`);
    return window;
}
function setOverlayMode(window, mode) {
    const currentBounds = window.getBounds();
    const nextSize = OVERLAY_SIZES[mode];
    window.setBounds({
        x: currentBounds.x,
        y: currentBounds.y,
        width: nextSize.width,
        height: nextSize.height
    });
}
