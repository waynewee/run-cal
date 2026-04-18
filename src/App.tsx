import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import "./App.css";
import {
  clearStoredPlan,
  createTemplatePlan,
  downloadJson,
  formatCalendarDate,
  formatLongDate,
  formatWeekday,
  getEventsForDate,
  getResolvedEvents,
  parsePlanJson,
  readStoredPlan,
  type ResolvedWorkoutEvent,
  type WorkoutPlan,
  writeStoredPlan,
} from "./scheduler";

type ActiveView = "scheduler" | "today" | "plan";

type TabConfig = {
  id: ActiveView;
  label: string;
};

const TABS: TabConfig[] = [
  { id: "today", label: "Today" },
  { id: "plan", label: "Preview" },
  { id: "scheduler", label: "Manage" },
];

function App() {
  const [plan, setPlan] = useState<WorkoutPlan | null>(null);
  const [hasLoadedPlan, setHasLoadedPlan] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState(
    "Import a workout plan to get started.",
  );
  const [activeView, setActiveView] = useState<ActiveView>("today");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const today = new Date();
  const todayDateKey = toDateKey(today);
  const todaysEvents = plan ? getEventsForDate(plan, today) : [];
  const allEvents = plan
    ? getResolvedEvents(plan).sort(
        (left, right) =>
          left.date.localeCompare(right.date) ||
          left.startTime.localeCompare(right.startTime),
      )
    : [];
  const nextWorkout = allEvents.find((event) => event.date > todayDateKey);

  useEffect(() => {
    let isCurrent = true;

    void (async () => {
      try {
        const storedPlan = await readStoredPlan();

        if (!isCurrent) {
          return;
        }

        setPlan(storedPlan);
        if (storedPlan) {
          setStatusMessage("Loaded saved workout plan.");
        }
      } catch {
        if (!isCurrent) {
          return;
        }

        setErrorMessage("Could not load the saved workout plan.");
      } finally {
        if (isCurrent) {
          setHasLoadedPlan(true);
        }
      }
    })();

    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedPlan) {
      return;
    }

    void (async () => {
      try {
        if (plan) {
          await writeStoredPlan(plan);
        } else {
          await clearStoredPlan();
        }
      } catch {
        setErrorMessage("Could not save the active workout plan.");
      }
    })();
  }, [hasLoadedPlan, plan]);

  const openImportDialog = () => {
    fileInputRef.current?.click();
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const parsedPlan = parsePlanJson(await file.text());

      if (plan) {
        const shouldReplace = window.confirm("Replace the active plan?");

        if (!shouldReplace) {
          event.target.value = "";
          return;
        }
      }

      setPlan(parsedPlan);
      setActiveView("today");
      setErrorMessage("");
      setStatusMessage("Imported workout events.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "The selected file could not be imported.",
      );
    } finally {
      event.target.value = "";
    }
  };

  const handleExportActivePlan = () => {
    if (!plan) {
      return;
    }

    downloadJson(plan, "active-workout-plan.json");
    setStatusMessage("Exported the active plan.");
  };

  const handleExportTemplatePlan = () => {
    downloadJson(createTemplatePlan(today), "workout-plan-template.json");
    setStatusMessage("Exported a blank template.");
  };

  return (
    <main className={`app-shell ${plan ? "plan-active" : ""}`}>
      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        accept="application/json"
        onChange={handleImport}
      />

      <header className="tab-bar" aria-label="Navigation tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab-button ${activeView === tab.id ? "active" : ""}`}
            type="button"
            aria-pressed={activeView === tab.id}
            onClick={() => setActiveView(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </header>

      {activeView === "scheduler" ? (
        <section className="hero-panel" aria-label="Workout scheduler">
          <div className="hero-copy">
            <p className="eyebrow">Workout Scheduler</p>
            <h1>{plan ? "Manage active plan" : "Import a plan"}</h1>
            <p className="lede">
              {plan
                ? "Replace the active plan or export it for editing outside the app."
                : "Load a one-time workout plan from JSON. Only one active plan is stored on this device at a time."}
            </p>
          </div>

          <div className={`action-row ${plan ? "compact" : ""}`}>
            <button
              className="primary-button"
              type="button"
              disabled={!hasLoadedPlan}
              onClick={openImportDialog}
            >
              {plan ? "Replace plan" : "Import plan"}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={!hasLoadedPlan}
              onClick={plan ? handleExportActivePlan : handleExportTemplatePlan}
            >
              {plan ? "Export active plan" : "Export template"}
            </button>
            {plan ? (
              <button
                className="secondary-button"
                type="button"
                disabled={!hasLoadedPlan}
                onClick={handleExportTemplatePlan}
              >
                Export template plan
              </button>
            ) : null}
          </div>

          <p className="status-line" role="status">
            {statusMessage}
          </p>
          {errorMessage ? <p className="error-line">{errorMessage}</p> : null}
        </section>
      ) : (
        <section
          className="schedule-panel"
          aria-label={
            activeView === "plan" ? "Full workout plan" : "Today's workouts"
          }
        >
          {plan ? (
            <>
              <div className="schedule-header">
                <div>
                  <p className="section-label">
                    {activeView === "plan" ? "Full plan" : "Today"}
                  </p>
                  <h2
                    className={
                      activeView === "today" ? "date-with-weekday" : ""
                    }
                  >
                    {activeView === "plan"
                      ? "Plan preview"
                      : formatCalendarDate(today)}
                    {activeView === "today" ? (
                      <span className="date-weekday">
                        {formatWeekday(today)}
                      </span>
                    ) : null}
                  </h2>
                </div>
              </div>

              {activeView === "plan" ? (
                allEvents.length > 0 ? (
                  <div className="event-list" aria-label="Full plan preview">
                    {allEvents.map((workout) => (
                      <EventCard key={workout.id} workout={workout} showDate />
                    ))}
                  </div>
                ) : (
                  <article className="rest-card">
                    <p className="section-label">Plan preview</p>
                    <h3>No workouts in this plan</h3>
                    <p>
                      Import a plan with events to preview the full schedule.
                    </p>
                  </article>
                )
              ) : todaysEvents.length > 0 ? (
                <div className="event-list" aria-label={formatLongDate(today)}>
                  {todaysEvents.map((workout) => (
                    <EventCard key={workout.id} workout={workout} />
                  ))}
                </div>
              ) : (
                <article className="rest-card">
                  <p className="section-label">Rest day</p>
                  <h3>No workout today</h3>
                  <p>
                    The active plan has no events scheduled for{" "}
                    {formatCalendarDate(today)}.{" "}
                    {nextWorkout
                      ? `Next event is scheduled for ${formatNextWeekday(nextWorkout.date)}.`
                      : "No future events are scheduled in the active plan."}
                  </p>
                </article>
              )}
            </>
          ) : (
            <article className="empty-card">
              <p className="section-label">
                {activeView === "plan" ? "Plan preview" : "Today"}
              </p>
              <h2>
                {!hasLoadedPlan
                  ? "Loading saved plan"
                  : activeView === "plan"
                    ? "No plan to preview"
                    : "No event for today yet"}
              </h2>
              <p>
                {!hasLoadedPlan
                  ? "Checking IndexedDB for the active plan on this device."
                  : "Import a workout plan from the Workout Scheduler tab to view the"}
                {hasLoadedPlan
                  ? activeView === "plan"
                    ? " full schedule."
                    : " current day event."
                  : null}
              </p>
            </article>
          )}
        </section>
      )}
    </main>
  );
}

type EventCardProps = {
  workout: ResolvedWorkoutEvent;
  showDate?: boolean;
};

function EventCard({ workout, showDate = false }: EventCardProps) {
  return (
    <article className="event-card">
      {showDate ? <p className="event-date">{workout.date}</p> : null}
      <p className="event-time">
        {workout.startTime}
        {workout.endTime ? ` - ${workout.endTime}` : ""}
      </p>
      <h3>{workout.title}</h3>
      {workout.location ? (
        <p className="event-detail">{workout.location}</p>
      ) : null}
      {workout.notes ? <p className="event-detail">{workout.notes}</p> : null}
      {workout.isOverridden ? (
        <p className="override-pill">Rescheduled</p>
      ) : null}
    </article>
  );
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatNextWeekday(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);

  return `next ${formatWeekday(new Date(year, month - 1, day))}`;
}

export default App;
