# App Icons for Tele Coach

Replace the placeholder files in this directory with production icons for each platform.

## Required files

| File        | Platform | Format / notes |
|------------|----------|-----------------|
| `icon.icns` | macOS    | Multi-resolution .icns (e.g. 16×16, 32×32, 64×64, 128×128, 256×256, 512×512). Used for app and DMG. |
| `icon.ico`  | Windows  | Multi-size .ico (e.g. 16×16, 32×32, 48×48, 256×256). Used for app, installer, and shortcuts. |
| `icon.png`  | Linux    | Single PNG, 256×256 or 512×512 recommended. Used for AppImage and desktop. |
| `icon.svg`  | Optional | Source vector; used as reference. electron-builder uses the platform-specific files above. |

## Generating from a source image

- **macOS .icns**: Use `iconutil` or a tool like [electron-icon-builder](https://www.npmjs.com/package/electron-icon-builder). Provide a 1024×1024 PNG; output `icon.icns`.
- **Windows .ico**: Use ImageMagick (`convert icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico`) or an online converter. Include 16, 32, 48, 256.
- **Linux .png**: A 256×256 or 512×512 PNG is sufficient.

## Paths referenced in build

- `electron-builder.json` points to: `assets/icons/icon.icns` (mac), `assets/icons/icon.ico` (win), `assets/icons/icon.png` (linux).
- Ensure these paths exist and are **valid image files**; otherwise the build may fail (e.g. Windows NSIS build fails with "unknown format" if `icon.ico` is a placeholder text file). Replace placeholders with real .ico (and .png/.icns) before running `electron-builder --win`.
