import { OverlayView } from "./components/overlay_view";
import { SettingsPage } from "./pages/settings_page";

export function App(): JSX.Element {
  const hash = typeof window !== "undefined" ? window.location.hash : "#overlay";
  const mode: "overlay" | "settings" = hash === "#settings" ? "settings" : "overlay";

  return mode === "overlay" ? <OverlayView /> : <SettingsPage />;
}
