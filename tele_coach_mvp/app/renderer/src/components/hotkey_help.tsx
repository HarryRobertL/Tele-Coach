export function HotkeyHelp(): JSX.Element {
  // TODO: Connect global shortcut registration from Electron.
  return (
    <section>
      <h3>Hotkeys</h3>
      <p>Start/Stop listening: Cmd+Shift+L</p>
      <p>Toggle overlay: Cmd+Shift+O</p>
    </section>
  );
}
