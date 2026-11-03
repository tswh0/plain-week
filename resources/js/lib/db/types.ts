/**
 * Task colour ids, in the order the colour picker shows them. Visual styles
 * (swatches, text colours) belong to the UI layer, not here.
 */
export const TASK_COLORS = [
    'none',
    'pink',
    'yellow',
    'black',
    'grey',
    'cornflower',
    'mango',
    'green',
    'lilac',
] as const;

export type TaskColor = (typeof TASK_COLORS)[number];

/** Someday has three columns. */
export const SOMEDAY_COLUMNS = [0, 1, 2] as const;

export type SomedayColumn = (typeof SOMEDAY_COLUMNS)[number];

export type Subtask = {
    id: string;
    text: string;
    done: boolean;
};

/** ISO weekday: 1 is Monday, 7 is Sunday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** The largest `every` of a daily rule ("every 365 days"). */
export const MAX_EVERY_DAYS = 365;

/**
 * The repeat rule of a series row. `until` is the last date (inclusive) that
 * can produce an occurrence. A daily rule repeats every `every` days from the
 * series' `date`.
 */
export type Recurrence =
    | { type: 'daily'; every: number; until?: string | null }
    | { type: 'weekly'; weekdays: IsoWeekday[]; until?: string | null }
    | { type: 'monthly'; day: number; until?: string | null };

/**
 * A task, with exactly the shape of the sync contract (docs/architecture.md).
 * Keys are snake_case in Dexie and on the wire.
 */
export type Task = {
    id: string;
    text: string;
    /** 'YYYY-MM-DD', or null for Someday. */
    date: string | null;
    /** Required when `date` is null, otherwise null. */
    someday_column: SomedayColumn | null;
    /** Fractional index key: order within a day, or within a Someday column. */
    position: string;
    done: boolean;
    done_at: string | null;
    color: TaskColor;
    /** 'HH:mm' or null. */
    time: string | null;
    notes: string;
    subtasks: Subtask[];
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
    /** Only on a series row: its repeat rule (`date` is the anchor). */
    recurrence: Recurrence | null;
    /** Only on an exception row: the series it overrides. */
    series_id: string | null;
    /** Only on an exception row: the generated date it replaces. */
    occurrence_date: string | null;
};

/**
 * A pending local change. `revision` grows on every local mutation of the task,
 * so the sync engine can tell whether a record changed while it was in flight.
 */
export type OutboxEntry = {
    task_id: string;
    revision: number;
    /**
     * Set when the server refused this revision as invalid (422). The entry is
     * skipped by push until the task changes again.
     */
    failed_revision?: number;
};

/**
 * `cursor`, `cursor_format` and `user_id` belong to the sync engine;
 * `demo_seeded` and `demo_ids` to the guest onboarding (`lib/db/demo.ts`) and
 * never sync.
 */
export type MetaKey =
    | 'cursor'
    | 'cursor_format'
    | 'user_id'
    | 'demo_seeded'
    | 'demo_ids';

export type MetaEntry = {
    key: MetaKey;
    value: string | number | string[];
};
