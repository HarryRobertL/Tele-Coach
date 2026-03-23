import { useEffect, useState } from "react";

interface Last7DayStats {
  sessions_count: number;
  top_objections: Array<{ objection_id: string; count: number }>;
  outcomes_distribution: Array<{ outcome: "worked" | "neutral" | "did_not_work"; count: number }>;
}

export function DashboardPage(): JSX.Element {
  const [stats, setStats] = useState<Last7DayStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await window.api.getStats();
        if (!cancelled) {
          setStats(result as Last7DayStats);
        }
      } catch (err) {
        if (!cancelled) {
          setError("Unable to load last 7 days performance.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="dashboard" aria-label="Tele Coach dashboard">
      <header className="overlay-header">
        <h1 className="overlay-header__title">Tele Coach</h1>
        <p className="overlay-header__subtitle">Last 7 Days Performance</p>
      </header>
      {loading && <p className="status-line">Loading performance data…</p>}
      {error && <p className="status-line">{error}</p>}
      {stats && (
        <>
          <section className="compact-block" aria-label="Sessions summary">
            <div className="coaching-pack__block">
              <div className="coaching-pack__label">SESSIONS</div>
              <div className="coaching-pack__content">
                {stats.sessions_count}
              </div>
            </div>
          </section>
          <section className="compact-block" aria-label="Top objections">
            <div className="coaching-pack__block">
              <div className="coaching-pack__label">TOP OBJECTIONS</div>
              <div className="coaching-pack__content">
                {stats.top_objections.length === 0 ? (
                  <span>No objections logged yet.</span>
                ) : (
                  <ul>
                    {stats.top_objections.map((o) => (
                      <li key={o.objection_id}>
                        {o.objection_id}: {o.count}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
          <section className="compact-block" aria-label="Outcomes distribution">
            <div className="coaching-pack__block">
              <div className="coaching-pack__label">OUTCOMES</div>
              <div className="coaching-pack__content">
                {stats.outcomes_distribution.length === 0 ? (
                  <span>No outcomes logged yet.</span>
                ) : (
                  <ul>
                    {stats.outcomes_distribution.map((o) => (
                      <li key={o.outcome}>
                        {o.outcome}: {o.count}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

