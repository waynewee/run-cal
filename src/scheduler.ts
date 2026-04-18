export const ACTIVE_PLAN_STORAGE_KEY = "run-cal.active-plan";

const DATABASE_NAME = "run-cal";
const STORE_NAME = "app-state";

export type WorkoutEvent = {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime?: string;
  location?: string;
  notes?: string;
};

export type WorkoutOverride = {
  eventId: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  title?: string;
  location?: string;
  notes?: string;
};

export type WorkoutPlan = {
  version: 1;
  generatedAt: string;
  events: WorkoutEvent[];
  overrides: WorkoutOverride[];
};

export type ResolvedWorkoutEvent = WorkoutEvent & {
  isOverridden: boolean;
};

type StoredValueRecord = {
  key: string;
  value: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Failed to open IndexedDB."));
    };
  });
}

function readStoredValue(key: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    openDatabase()
      .then((database) => {
        const transaction = database.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(key);

        request.onsuccess = () => {
          const record = request.result as StoredValueRecord | undefined;
          resolve(record?.value ?? null);
        };

        request.onerror = () => {
          reject(request.error ?? new Error("Failed to read from IndexedDB."));
        };

        transaction.oncomplete = () => {
          database.close();
        };

        transaction.onerror = () => {
          reject(
            transaction.error ?? new Error("Failed to read from IndexedDB."),
          );
        };
      })
      .catch(reject);
  });
}

function writeStoredValue(key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    openDatabase()
      .then((database) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);

        store.put({ key, value } satisfies StoredValueRecord);

        transaction.oncomplete = () => {
          database.close();
          resolve();
        };

        transaction.onerror = () => {
          reject(
            transaction.error ?? new Error("Failed to write to IndexedDB."),
          );
        };
      })
      .catch(reject);
  });
}

function deleteStoredValue(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    openDatabase()
      .then((database) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);

        store.delete(key);

        transaction.oncomplete = () => {
          database.close();
          resolve();
        };

        transaction.onerror = () => {
          reject(
            transaction.error ?? new Error("Failed to delete from IndexedDB."),
          );
        };
      })
      .catch(reject);
  });
}

async function migrateLegacyStoredPlan(): Promise<string | null> {
  const legacyPlan = window.localStorage.getItem(ACTIVE_PLAN_STORAGE_KEY);

  if (!legacyPlan) {
    return null;
  }

  try {
    const parsedPlan = parsePlanJson(legacyPlan);
    const serializedPlan = JSON.stringify(parsedPlan, null, 2);

    await writeStoredValue(ACTIVE_PLAN_STORAGE_KEY, serializedPlan);
    window.localStorage.removeItem(ACTIVE_PLAN_STORAGE_KEY);

    return serializedPlan;
  } catch {
    window.localStorage.removeItem(ACTIVE_PLAN_STORAGE_KEY);
    return null;
  }
}

export async function readStoredPlan(): Promise<WorkoutPlan | null> {
  let storedPlan = await readStoredValue(ACTIVE_PLAN_STORAGE_KEY);

  if (!storedPlan) {
    storedPlan = await migrateLegacyStoredPlan();
  }

  if (!storedPlan) {
    return null;
  }

  try {
    return parsePlanJson(storedPlan);
  } catch {
    await clearStoredPlan();
    return null;
  }
}

export async function writeStoredPlan(plan: WorkoutPlan): Promise<void> {
  await writeStoredValue(
    ACTIVE_PLAN_STORAGE_KEY,
    JSON.stringify(plan, null, 2),
  );
}

export async function clearStoredPlan(): Promise<void> {
  await deleteStoredValue(ACTIVE_PLAN_STORAGE_KEY);
  window.localStorage.removeItem(ACTIVE_PLAN_STORAGE_KEY);
}

export function parsePlanJson(source: string): WorkoutPlan {
  const parsed = JSON.parse(source) as Partial<WorkoutPlan>;

  if (parsed.version !== 1) {
    throw new Error("Invalid plan format: version must be 1.");
  }

  if (!Array.isArray(parsed.events)) {
    throw new Error("Invalid plan format: events must be an array.");
  }

  const events = parsed.events.map(parseEvent);
  const eventIds = new Set<string>();

  for (const event of events) {
    if (eventIds.has(event.id)) {
      throw new Error(`Invalid plan format: duplicate event id "${event.id}".`);
    }

    eventIds.add(event.id);
  }

  const overrides = Array.isArray(parsed.overrides)
    ? parsed.overrides.map((override) => parseOverride(override, eventIds))
    : [];

  return {
    version: 1,
    generatedAt:
      typeof parsed.generatedAt === "string" && parsed.generatedAt.trim() !== ""
        ? parsed.generatedAt
        : new Date().toISOString(),
    events,
    overrides,
  };
}

export function getEventsForDate(
  plan: WorkoutPlan,
  date: Date,
): ResolvedWorkoutEvent[] {
  const currentDate = toDateKey(date);

  return getResolvedEvents(plan)
    .filter((event) => event.date === currentDate)
    .sort((left, right) => left.startTime.localeCompare(right.startTime));
}

export function getResolvedEvents(plan: WorkoutPlan): ResolvedWorkoutEvent[] {
  const overrideMap = new Map(
    plan.overrides.map((override) => [override.eventId, override]),
  );

  return plan.events.map((event) => {
    const override = overrideMap.get(event.id);

    if (!override) {
      return { ...event, isOverridden: false };
    }

    return {
      ...event,
      ...override,
      id: event.id,
      isOverridden: true,
    };
  });
}

export function createTemplatePlan(today: Date): WorkoutPlan {
  const baseDate = new Date(today);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    events: [
      {
        id: "workout-001",
        title: "Upper Body Strength",
        date: toDateKey(baseDate),
        startTime: "07:00",
        endTime: "07:45",
        location: "Gym",
        notes: "Bench, rows, shoulder press",
      },
      {
        id: "workout-002",
        title: "Easy Run",
        date: toDateKey(addDays(baseDate, 1)),
        startTime: "06:30",
        endTime: "07:10",
        location: "River trail",
        notes: "Keep the effort conversational.",
      },
      {
        id: "workout-003",
        title: "Lower Body Strength",
        date: toDateKey(addDays(baseDate, 2)),
        startTime: "17:30",
        endTime: "18:20",
        location: "Gym",
        notes: "Squats, deadlifts, split squats.",
      },
      {
        id: "workout-004",
        title: "Mobility Session",
        date: toDateKey(addDays(baseDate, 3)),
        startTime: "07:15",
        endTime: "07:45",
        location: "Home",
        notes: "Hips, thoracic spine, ankles.",
      },
      {
        id: "workout-005",
        title: "Long Run",
        date: toDateKey(addDays(baseDate, 4)),
        startTime: "08:00",
        endTime: "09:15",
        location: "Park loop",
        notes: "Steady pace with relaxed finish.",
      },
    ],
    overrides: [
      {
        eventId: "workout-003",
        date: toDateKey(addDays(baseDate, 3)),
        startTime: "18:30",
        notes: "Moved a day later because of travel.",
      },
    ],
  };
}

export function downloadJson(plan: WorkoutPlan, fileName: string) {
  const blob = new Blob([JSON.stringify(plan, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  anchor.click();

  URL.revokeObjectURL(url);
}

export function formatLongDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function formatCalendarDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
  }).format(date);
}

export function formatWeekday(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
  }).format(date);
}

function parseEvent(value: unknown): WorkoutEvent {
  if (!isRecord(value)) {
    throw new Error("Invalid plan format: each event must be an object.");
  }

  const event: WorkoutEvent = {
    id: readRequiredString(value.id, "event.id"),
    title: readRequiredString(value.title, "event.title"),
    date: readRequiredString(value.date, "event.date"),
    startTime: readRequiredString(value.startTime, "event.startTime"),
  };

  validateDate(event.date, "event.date");
  validateTime(event.startTime, "event.startTime");

  const endTime = readOptionalString(value.endTime, "event.endTime");

  if (endTime) {
    validateTime(endTime, "event.endTime");
    event.endTime = endTime;
  }

  const location = readOptionalString(value.location, "event.location");
  const notes = readOptionalString(value.notes, "event.notes");

  if (location) {
    event.location = location;
  }

  if (notes) {
    event.notes = notes;
  }

  return event;
}

function parseOverride(value: unknown, eventIds: Set<string>): WorkoutOverride {
  if (!isRecord(value)) {
    throw new Error("Invalid plan format: each override must be an object.");
  }

  const eventId = readRequiredString(value.eventId, "override.eventId");

  if (!eventIds.has(eventId)) {
    throw new Error(
      `Invalid plan format: override references unknown event id "${eventId}".`,
    );
  }

  const override: WorkoutOverride = { eventId };
  const date = readOptionalString(value.date, "override.date");
  const startTime = readOptionalString(value.startTime, "override.startTime");
  const endTime = readOptionalString(value.endTime, "override.endTime");
  const title = readOptionalString(value.title, "override.title");
  const location = readOptionalString(value.location, "override.location");
  const notes = readOptionalString(value.notes, "override.notes");

  if (!date && !startTime && !endTime && !title && !location && !notes) {
    throw new Error(
      `Invalid plan format: override for "${eventId}" has no changes.`,
    );
  }

  if (date) {
    validateDate(date, "override.date");
    override.date = date;
  }

  if (startTime) {
    validateTime(startTime, "override.startTime");
    override.startTime = startTime;
  }

  if (endTime) {
    validateTime(endTime, "override.endTime");
    override.endTime = endTime;
  }

  if (title) {
    override.title = title;
  }

  if (location) {
    override.location = location;
  }

  if (notes) {
    override.notes = notes;
  }

  return override;
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid plan format: ${fieldName} is required.`);
  }

  return value.trim();
}

function readOptionalString(
  value: unknown,
  fieldName: string,
): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Invalid plan format: ${fieldName} must be a string.`);
  }

  return value.trim();
}

function validateDate(value: string, fieldName: string) {
  if (!DATE_PATTERN.test(value)) {
    throw new Error(`Invalid plan format: ${fieldName} must use YYYY-MM-DD.`);
  }
}

function validateTime(value: string, fieldName: string) {
  if (!TIME_PATTERN.test(value)) {
    throw new Error(`Invalid plan format: ${fieldName} must use HH:MM.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function addDays(date: Date, amount: number): Date {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + amount);
  return nextDate;
}
