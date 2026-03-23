import { useEffect, useState } from "react";
import { OverlayView } from "./components/overlay_view";
import { SettingsPage } from "./pages/settings_page";
import { DashboardPage } from "./pages/dashboard_page";

export function App(): JSX.Element {
  const [flags, setFlags] = useState<{ operator_dashboard_enabled: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await window.api.getFeatureFlags();
        if (!cancelled) {
          setFlags(result as { operator_dashboard_enabled: boolean });
        }
      } catch {
        if (!cancelled) {
          setFlags({ operator_dashboard_enabled: false });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hash = typeof window !== "undefined" ? window.location.hash : "#overlay";
  const requestedMode: "overlay" | "settings" | "dashboard" =
    hash === "#settings" ? "settings" : hash === "#dashboard" ? "dashboard" : "overlay";

  if (!flags) {
    return <OverlayView />;
  }

  const mode =
    requestedMode === "dashboard" && !flags.operator_dashboard_enabled
      ? "overlay"
      : requestedMode;

  if (mode === "settings") return <SettingsPage />;
  if (mode === "dashboard") return <DashboardPage />;
  return <OverlayView />;
}
