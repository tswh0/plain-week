import { describe, expect, it } from 'vite-plus/test';
import { parseDateKey } from '@/lib/db/dates';
import type { Task } from '@/lib/db/types';
import {
    edgeDropDate,
    originalSpot,
    placementKey,
    placementLabel,
    resolveDrop,
    resolveListDrop,
} from './drop';

const MONDAY = '2026-10-12';
const TUESDAY = '2026-10-13';
const WEEK = parseDateKey(MONDAY);

function task(id: string, overrides: Partial<Task> = {}): Task {
    return {
        id,
        text: id,
        date: MONDAY,
        someday_column: null,
        position: id,
        done: false,
        done_at: null,
        color: 'none',
        time: null,
        notes: '',
        subtasks: [],
        created_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-10-01T00:00:00.000Z',
        deleted_at: null,
        recurrence: null,
        series_id: null,
        occurrence_date: null,
        ...overrides,
    };
}

const a = task('a');
const b = task('b');
const c = task('c');
const monday = [a, b, c];

describe('resolveListDrop', () => {
    it('reorders within a day', () => {
        expect(resolveListDrop(c, { date: MONDAY }, monday, 0)).toEqual({
            move: { date: MONDAY, afterId: null, beforeId: 'a' },
            indicator: { listKey: MONDAY, beforeTaskId: 'a' },
        });
        expect(resolveListDrop(a, { date: MONDAY }, monday, 2)?.move).toEqual({
            date: MONDAY,
            afterId: 'b',
            beforeId: 'c',
        });
        expect(resolveListDrop(a, { date: MONDAY }, monday, 3)?.move).toEqual({
            date: MONDAY,
            afterId: 'c',
            beforeId: null,
        });
    });

    it('returns null when the task would stay where it is', () => {
        expect(resolveListDrop(b, { date: MONDAY }, monday, 1)).toBeNull();
        expect(resolveListDrop(b, { date: MONDAY }, monday, 2)).toBeNull();
    });

    it('moves to another day between the rows of the slot', () => {
        const d = task('d', { date: TUESDAY });

        expect(resolveListDrop(a, { date: TUESDAY }, [d], 1)).toEqual({
            move: { date: TUESDAY, afterId: 'd', beforeId: null },
            indicator: { listKey: TUESDAY, beforeTaskId: null },
        });
        expect(resolveListDrop(a, { date: TUESDAY }, [], 0)?.move).toEqual({
            date: TUESDAY,
            afterId: null,
            beforeId: null,
        });
    });

    it('moves to and from Someday', () => {
        const s = task('s', { date: null, someday_column: 1 });

        expect(resolveListDrop(a, { date: null }, [s], 0)).toEqual({
            move: {
                date: null,
                afterId: null,
                beforeId: 's',
            },
            indicator: { listKey: 'someday', beforeTaskId: 's' },
        });
        expect(resolveListDrop(s, { date: MONDAY }, monday, 1)?.move).toEqual({
            date: MONDAY,
            afterId: 'a',
            beforeId: 'b',
        });
        // Someday is one list, whatever column its rows are in.
        expect(resolveListDrop(s, { date: null }, [s], 1)).toBeNull();
    });

    it('uses only untimed tasks as neighbours in a day', () => {
        const t1 = task('t1', { time: '09:00', position: 'z' });
        const t2 = task('t2', { time: '10:00', position: 'y' });
        const day = [t1, t2, a, b];
        const other = task('x', { date: TUESDAY });

        // Dropped among the timed tasks: lands before the first untimed one.
        expect(resolveListDrop(other, { date: MONDAY }, day, 1)).toEqual({
            move: { date: MONDAY, afterId: null, beforeId: 'a' },
            indicator: { listKey: MONDAY, beforeTaskId: 'a' },
        });
        expect(resolveListDrop(other, { date: MONDAY }, day, 3)?.move).toEqual({
            date: MONDAY,
            afterId: 'a',
            beforeId: 'b',
        });
        // Moving an untimed task above the timed ones keeps it first untimed.
        expect(resolveListDrop(a, { date: MONDAY }, day, 0)).toBeNull();
    });

    it('keeps a timed task in its slot by time', () => {
        const t1 = task('t1', { time: '09:00' });
        const t2 = task('t2', { time: '10:00' });
        const late = task('late', { time: '09:30', date: TUESDAY });

        expect(
            resolveListDrop(t1, { date: MONDAY }, [t1, t2, a], 3),
        ).toBeNull();
        expect(
            resolveListDrop(late, { date: MONDAY }, [t1, t2, a], 3)?.indicator,
        ).toEqual({ listKey: MONDAY, beforeTaskId: 't2' });
    });

    it('treats Someday as positional even for timed tasks', () => {
        const s1 = task('s1', { date: null, someday_column: 0, time: '09:00' });
        const s2 = task('s2', { date: null });

        expect(resolveListDrop(s2, { date: null }, [s1, s2], 0)?.move).toEqual({
            date: null,
            afterId: null,
            beforeId: 's1',
        });
    });
});

describe('resolveDrop', () => {
    it('drops above or below the task under the pointer', () => {
        const target = {
            type: 'task' as const,
            placement: { date: MONDAY },
            tasks: monday,
            taskId: 'b',
        };

        expect(resolveDrop(c, { ...target, below: false }, WEEK)?.move).toEqual(
            { date: MONDAY, afterId: 'a', beforeId: 'b' },
        );
        expect(resolveDrop(a, { ...target, below: true }, WEEK)?.move).toEqual({
            date: MONDAY,
            afterId: 'b',
            beforeId: 'c',
        });
    });

    it('appends when dropped on the list (its empty rows)', () => {
        expect(
            resolveDrop(
                task('x', { date: TUESDAY }),
                { type: 'list', placement: { date: MONDAY }, tasks: monday },
                WEEK,
            )?.move,
        ).toEqual({ date: MONDAY, afterId: 'c', beforeId: null });
    });

    it('moves to the same weekday of the next or previous week on an edge', () => {
        const wednesday = task('w', { date: '2026-10-14' });

        expect(
            resolveDrop(wednesday, { type: 'edge', direction: 1 }, WEEK),
        ).toEqual({ move: { date: '2026-10-21' }, indicator: null });
        expect(
            resolveDrop(wednesday, { type: 'edge', direction: -1 }, WEEK),
        ).toEqual({ move: { date: '2026-10-07' }, indicator: null });
    });

    it('does nothing when an edge drop lands on the same day', () => {
        const wednesday = task('w', { date: '2026-10-14' });

        // The previous week of W43 is the task's own week.
        expect(
            resolveDrop(
                wednesday,
                { type: 'edge', direction: -1 },
                parseDateKey('2026-10-19'),
            ),
        ).toBeNull();
    });
});

describe('edgeDropDate', () => {
    it('targets the week beyond the shown one', () => {
        const friday = task('f', { date: '2026-10-16' });

        expect(edgeDropDate(friday, parseDateKey('2026-10-19'), 1)).toBe(
            '2026-10-30',
        );
    });

    it('keeps Sunday as the last day of the week', () => {
        const sunday = task('s', { date: '2026-10-18' });

        expect(edgeDropDate(sunday, WEEK, 1)).toBe('2026-10-25');
        expect(edgeDropDate(sunday, WEEK, -1)).toBe('2026-10-11');
    });

    it('crosses month and year boundaries', () => {
        const thursday = task('t', { date: '2026-12-31' });

        expect(edgeDropDate(thursday, parseDateKey('2026-12-28'), 1)).toBe(
            '2027-01-07',
        );
        expect(edgeDropDate(thursday, parseDateKey('2026-12-28'), -1)).toBe(
            '2026-12-24',
        );
    });

    it('sends a Someday task to the Monday of that week', () => {
        const someday = task('s', { date: null });

        expect(edgeDropDate(someday, WEEK, 1)).toBe('2026-10-19');
        expect(edgeDropDate(someday, WEEK, -1)).toBe('2026-10-05');
    });
});

describe('placementKey and placementLabel', () => {
    it('names days and Someday', () => {
        expect(placementKey({ date: MONDAY })).toBe(MONDAY);
        expect(placementKey({ date: null })).toBe('someday');
        expect(placementLabel({ date: MONDAY })).toBe('Mon 12 Oct');
        expect(placementLabel({ date: null })).toBe('Someday');
    });
});

describe('originalSpot', () => {
    it('puts a task back between its positional neighbours', () => {
        expect(
            originalSpot(b, { placement: { date: MONDAY }, tasks: monday }),
        ).toEqual({
            date: MONDAY,
            afterId: 'a',
            beforeId: 'c',
        });
    });

    it('skips timed tasks in a day', () => {
        const timed = task('t', { time: '09:00' });

        expect(
            originalSpot(a, {
                placement: { date: MONDAY },
                tasks: [timed, a, b],
            }),
        ).toEqual({ date: MONDAY, afterId: undefined, beforeId: 'b' });
    });
});
