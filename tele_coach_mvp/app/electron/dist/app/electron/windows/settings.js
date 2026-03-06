"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSettingsWindow = createSettingsWindow;
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
function createSettingsWindow(rendererUrl) {
    const window = new electron_1.BrowserWindow({
        width: 900,
        height: 680,
        show: false,
        frame: true,
        autoHideMenuBar: true,
        title: "Tele Coach Settings",
        webPreferences: {
            preload: node_path_1.default.resolve(__dirname, "../preload.js"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    void window.loadURL(`${rendererUrl}#settings`);
    return window;
}
