# Tele Coach - Packaging Documentation

## Overview

Tele Coach uses **electron-builder** for packaging and distribution. This tool creates installers for multiple platforms without requiring users to have Node.js or npm installed.

## Configuration Files

### Main Configuration
- **File**: `electron-builder.json`
- **Purpose**: Defines build settings, targets, and metadata for all platforms

### Platform-Specific Files
- **macOS Entitlements**: `assets/entitlements.mac.plist` - Required for sandboxing and microphone access
- **Icons**: `assets/icons/` - Contains placeholder icons for all platforms

## Build Scripts

### Available Commands

```bash
# Standard build (required before packaging)
npm run build         # Builds renderer and electron code (includes playbook/bridges copy)

# Development builds (unpacked)
npm run pack          # Creates unpacked builds for current platform

# Distribution builds (installers)
npm run dist          # Creates installers for current platform
npm run dist:mac      # macOS .dmg for both arches (use arch-specific commands for correct Whisper binary)
npm run dist:mac:arm64  # Build + prepack Whisper for arm64 + macOS arm64 .dmg
npm run dist:mac:x64    # Build + prepack Whisper for x64 + macOS x64 .dmg
npm run dist:win      # Build + prepack Whisper for Windows x64 + .exe installer

# Prepack only (download Whisper binary + model for a given platform/arch)
npm run prepack:whisper   # Use with args: node scripts/prepack-whisper.js <platform> <arch>
```

## Release build (one-download)

For a production release where the user installs once and the app works with no setup (Whisper and playbook included):

1. Run **`npm run build`** to compile the app and copy playbook/bridges into `app/electron/dist/engine/playbooks/`.
2. For **each target architecture**, run the prepack script for that arch, then electron-builder for that arch only, so the correct Whisper binary is included in each installer:
   - **macOS arm64**: `npm run dist:mac:arm64` (builds, downloads Whisper for arm64, then creates `release/Tele Coach-1.0.0-arm64.dmg`).
   - **macOS x64**: `npm run dist:mac:x64` (builds, downloads Whisper for x64, then creates `release/Tele Coach-1.0.0-x64.dmg`).
   - **Windows x64**: `npm run dist:win` (builds, downloads Whisper for win x64, then creates `release/Tele Coach Setup 1.0.0.exe`).
3. **Artifact locations**: `release/*.dmg`, `release/*.exe` (see Platform Targets below).
4. Playbook and bridges are included via the copy step in `build:electron`. Whisper binary and model are in app resources; no user setup is required after install.

## Platform Targets

### macOS
- **Format**: `.dmg` disk image
- **Architectures**: x64 (Intel), arm64 (Apple Silicon)
- **Output**: `release/Tele Coach-1.0.0.dmg` and `release/Tele Coach-1.0.0-arm64.dmg`
- **Features**: 
  - Hardened runtime
  - Microphone access entitlements
  - Desktop and Start Menu shortcuts

### Windows
- **Format**: `.exe` installer (NSIS)
- **Architecture**: x64
- **Output**: `release/Tele Coach Setup 1.0.0.exe`
- **Features**:
  - Custom installation directory
  - Desktop shortcut
  - Start Menu shortcut

### Linux
- **Format**: `.AppImage` portable
- **Architecture**: x64
- **Output**: `release/Tele Coach-1.0.0.AppImage`

## Application Metadata

- **App ID**: `com.telecoach.desktop`
- **Product Name**: `Tele Coach`
- **Author**: `Creditsafe Limited`
- **Category**: Productivity

## Files Included in Package

The following files and directories are included in the final package:

```
app/electron/dist/          # Compiled Electron main process
app/renderer/dist/          # Built React frontend
engine/                     # Core coaching engine
data/                      # Data directory
node_modules/              # Dependencies
package.json              # Application metadata
```

### Extra Resources

- **Whisper Binary (mac/linux)**: `engine/stt/whisper/bin/whisper` → `whisper/bin/whisper`
- **Whisper Binary (windows)**: `engine/stt/whisper/bin/whisper.exe` → `whisper/bin/whisper.exe`
- **Whisper model (runtime)**: `engine/stt/whisper/models/ggml-tiny.en.bin` → `whisper/models/ggml-tiny.en.bin`

Only required runtime Whisper assets are packaged. Temporary source/import folders (for example local `whisper.cpp` source trees) are intentionally excluded.

## Build Requirements

### Development Machine
- Node.js 18+
- npm or yarn
- Platform-specific build tools (handled by electron-builder)

### Target Users
- No Node.js or npm required
- Standard desktop application installation

## Icon Assets

Production icons are required for store or formal distribution. See **`assets/icons/README.md`** for required formats and sizes:

- **macOS**: `icon.icns` (multi-resolution)
- **Windows**: `icon.ico` (multi-size: 16, 32, 48, 256)
- **Linux**: `icon.png` (256×256 or 512×512)

Replace the placeholder files in `assets/icons/` with your final artwork before production builds.

## Code Signing

Without code signing, macOS Gatekeeper and Windows SmartScreen may block or warn when users open the app. For public distribution, sign the installers as below.

### macOS (Apple Developer ID)

1. **Obtain a certificate**: Apple Developer Program membership, then create an "Developer ID Application" certificate in Keychain Access (or via Apple Developer portal).
2. **Export identity**: In Keychain, export the "Developer ID Application: Your Name (TEAM_ID)" certificate and private key as a `.p12` file. Note the password you set.
3. **Set environment variables** before running the dist script:
   - `CSC_LINK` – path to your `.p12` file (or a base64-encoded data URL of the file).
   - `CSC_KEY_PASSWORD` – password for the `.p12`.
   - `CSC_NAME` – (optional) exact name of the certificate in Keychain if you have multiple; e.g. `"Developer ID Application: Creditsafe Limited (XXXXXXXXXX)"`.
4. **Build**: e.g. `CSC_LINK=path/to/cert.p12 CSC_KEY_PASSWORD=yourpass npm run dist:mac:arm64`.
5. electron-builder will use these when present; see [electron-builder code signing](https://www.electron.build/code-signing).

### Windows (code signing certificate)

1. **Obtain a certificate**: EV or OV code signing certificate from a supported CA (e.g. DigiCert, Sectigo). Install it on the build machine (or use a hardware token / cloud signing).
2. **Set environment variables** before running the dist script:
   - `CSC_LINK` – path to your `.pfx` file (or a file URL).
   - `CSC_KEY_PASSWORD` – password for the `.pfx`.
   - Or use `CSC_VOLUME_NAME` and `CSC_KEYCHAIN` for Keychain-based signing on macOS when cross-building for Windows.
3. **Build**: e.g. `CSC_LINK=path/to/cert.pfx CSC_KEY_PASSWORD=yourpass npm run dist:win`.
4. For **timestamping** (recommended), set `CSC_TRUSTED_TIMESTAMP_SERVER_URL` to your CA’s TSA URL.

### Unset signing (ad-hoc / local only)

If you do not set `CSC_LINK`, electron-builder will use ad-hoc signing (macOS) or leave the Windows installer unsigned. Suitable for internal testing only.

## Troubleshooting

### Common Issues

1. **"electron" must be in devDependencies**
   - Fixed: Moved electron to devDependencies in package.json

2. **Missing author in package.json**
   - Fixed: Added "Creditsafe Limited" as author

3. **Invalid configuration properties**
   - Fixed: Removed invalid "description" from electron-builder.json

4. **Native dependency rebuilding**
   - electron-builder handles this automatically
   - Can also run manually with `npm run rebuild-native`

5. **Prepack fails with HTTP 404 for Whisper binary**
   - The prepack script downloads the Whisper binary from Hugging Face; URLs can change. If you see `Prepack failed: HTTP 404` for the binary (model may still download):
   - Run `npm run setup-whisper` on your machine to fetch binary and model into `engine/stt/whisper/`, then run `npm run build && electron-builder --mac --x64` (or the arch you need) without the prepack step so the existing binary is packed.
   - Or download a prebuilt binary from [GitHub whisper.cpp releases](https://github.com/ggml-org/whisper.cpp/releases) (or a community mirror), rename to `whisper` (or `whisper.exe` on Windows), and place it in `engine/stt/whisper/bin/` before running the dist script without prepack.

### Build Outputs

- **Unpacked builds**: `release/mac/`, `release/win/`, `release/linux/`
- **Installers**: `release/*.dmg`, `release/*.exe`, `release/*.AppImage`
- **Metadata**: `release/builder-*.yaml` files

## Release Process

1. Update version in `package.json` and, if needed, add release notes to `CHANGELOG.md`.
2. Replace placeholder icons in `assets/icons/` (see `assets/icons/README.md`).
3. Run `npm run build` to compile source (playbook and bridges are copied automatically).
4. For each target platform/arch, run the matching dist script so the correct Whisper binary is bundled (e.g. `npm run dist:mac:arm64`, then `npm run dist:mac:x64`, then `npm run dist:win`). If prepack fails to download the Whisper binary (e.g. 404), see Troubleshooting below.
5. Run Whisper release gate commands: `npm run typecheck`, `npm run verify-whisper`, `npm run test-whisper-runtime`.
6. For signed installers, set `CSC_LINK` and `CSC_KEY_PASSWORD` (and optionally `CSC_NAME`) before the dist command; see Code Signing above.
7. Test installers on target platforms.
8. Tag the release (e.g. `git tag v1.0.0`) and distribute installer files to users.

## Dependencies

The packaging setup relies on:
- `electron-builder` - Main packaging tool
- `@electron/rebuild` - Native dependency rebuilding
- Platform-specific build tools (auto-installed)

No additional configuration required beyond the files listed above.
