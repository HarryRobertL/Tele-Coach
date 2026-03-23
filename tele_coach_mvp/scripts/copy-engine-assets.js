#!/usr/bin/env node
/**
 * Copies playbook and bridge JSON assets into the compiled Electron output
 * so runtime __dirname resolution finds them next to playbook_loader.js and bridge_picker.js.
 * Run after tsc (build:electron).
 */

const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const sourceDir = path.join(projectRoot, "engine", "playbooks");
const targetDir = path.join(projectRoot, "app", "electron", "dist", "engine", "playbooks");

const ASSETS = [
  "creditsafe_playbook.json",
  "bridges.json",
  "default_en.json"
];

if (!fs.existsSync(sourceDir)) {
  console.error("copy-engine-assets: source directory missing:", sourceDir);
  process.exit(1);
}

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

for (const name of ASSETS) {
  const src = path.join(sourceDir, name);
  const dest = path.join(targetDir, name);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log("copy-engine-assets: copied", name);
  }
}
