import { describe, expect, it } from 'vite-plus/test';
import {
    compareListKeys,
    cursorAfterRemoval,
    firstInList,
    initialCursor,
    lastInList,
    moveCursor,
    newTaskRowCursor,
    resolveCursor,
    shiftCursorWeeks,
} from './cursor';
import type { CursorList } from './cursor';

const LISTS: CursorList[] = [
    { key: '2026-10-12', taskIds: ['a', 'b', 'c'] },
    { key: '2026-10-13', taskIds: ['d'] },
    { key: '2026-10-14', taskIds: [] },
    { key: 'someday', taskIds: ['s'] },
];

describe('compareListKeys', () => {
    it('orders days by date, then Someday', () => {
        expect(
            ['2026-10-18', 'someday', '2026-10-12'].sort(compareListKeys),
        ).toEqual(['2026-10-12', '2026-10-18', 'someday']);
    });
});

describe('resolveCursor', () => {
    it('follows its task to another list', () => {
        expect(
            resolveCursor(LISTS, {
                listKey: '2026-10-12',
                taskId: 'd',
                index: 0,
            }),
        ).toEqual({ listKey: '2026-10-13', taskId: 'd', index: 0 });
    });

    it('falls back to the same row when its task is gone', () => {
        expect(
            resolveCursor(LISTS, {
                listKey: '2026-10-12',
                taskId: 'x',
                index: 1,
            }),
        ).toEqual({ listKey: '2026-10-12', taskId: 'b', index: 1 });
        expect(
            resolveCursor(LISTS, {
                listKey: '2026-10-13',
                taskId: 'x',
                index: 1,
            }),
        ).toEqual({ listKey: '2026-10-13', taskId: null, index: 1 });
    });

    it('is null when its list is not on screen', () => {
        expect(
            resolveCursor(LISTS, {
                listKey: '2026-10-19',
                taskId: null,
                index: 0,
            }),
        ).toBeNull();
        expect(resolveCursor(LISTS, null)).toBeNull();
    });

    it('keeps a new-task row cursor on that row as tasks are added', () => {
        expect(resolveCursor(LISTS, newTaskRowCursor('2026-10-12'))).toEqual({
            listKey: '2026-10-12',
            taskId: null,
            index: 3,
        });
    });
});

describe('initialCursor', () => {
    it("starts on today's first task, or the first list in another week", () => {
        expect(initialCursor(LISTS, '2026-10-13')?.taskId).toBe('d');
        expect(initialCursor(LISTS, '2026-10-14')).toEqual({
            listKey: '2026-10-14',
            taskId: null,
            index: 0,
        });
        expect(initialCursor(LISTS, '2026-10-30')?.taskId).toBe('a');
        expect(initialCursor([], '2026-10-30')).toBeNull();
    });
});

describe('moveCursor', () => {
    const on = (listKey: string, index: number) =>
        resolveCursor(LISTS, { listKey, taskId: null, index })!;

    it('steps through a list, ending on its new-task row', () => {
        expect(moveCursor(LISTS, on('2026-10-12', 0), 'down').taskId).toBe('b');
        expect(moveCursor(LISTS, on('2026-10-12', 2), 'down')).toEqual({
            listKey: '2026-10-12',
            taskId: null,
            index: 3,
        });
        expect(moveCursor(LISTS, on('2026-10-12', 3), 'down').index).toBe(3);
        expect(moveCursor(LISTS, on('2026-10-12', 0), 'up').taskId).toBe('a');
    });

    it('moves across lists keeping roughly the same row', () => {
        expect(moveCursor(LISTS, on('2026-10-12', 2), 'nextList')).toEqual({
            listKey: '2026-10-13',
            taskId: null,
            index: 1,
        });
        expect(
            moveCursor(LISTS, on('2026-10-13', 0), 'previousList').taskId,
        ).toBe('a');
    });

    it('goes back to the row it was last on in a list', () => {
        const rows = new Map([['2026-10-12', 2]]);

        expect(
            moveCursor(LISTS, on('2026-10-13', 0), 'previousList', rows),
        ).toEqual({ listKey: '2026-10-12', taskId: 'c', index: 2 });
        // A list it has not been on: the same row.
        expect(
            moveCursor(LISTS, on('2026-10-13', 0), 'nextList', rows).listKey,
        ).toBe('2026-10-14');
    });

    it('goes from Sunday on to Someday, and stops at the ends', () => {
        expect(moveCursor(LISTS, on('2026-10-14', 0), 'nextList').taskId).toBe(
            's',
        );
        expect(moveCursor(LISTS, on('someday', 0), 'nextList').listKey).toBe(
            'someday',
        );
        expect(
            moveCursor(LISTS, on('2026-10-12', 1), 'previousList').taskId,
        ).toBe('b');
    });

    it('jumps to the first and last task', () => {
        expect(firstInList(LISTS, on('2026-10-12', 3)).taskId).toBe('a');
        expect(lastInList(LISTS, on('2026-10-12', 0)).taskId).toBe('c');
        expect(lastInList(LISTS, on('2026-10-14', 0)).taskId).toBeNull();
    });
});

describe('cursorAfterRemoval', () => {
    it('lands on the task that takes the row, or the new-task row', () => {
        expect(
            cursorAfterRemoval(LISTS, {
                listKey: '2026-10-12',
                taskId: 'b',
                index: 1,
            }),
        ).toEqual({ listKey: '2026-10-12', taskId: 'c', index: 1 });
        expect(
            cursorAfterRemoval(LISTS, {
                listKey: '2026-10-13',
                taskId: 'd',
                index: 0,
            }),
        ).toEqual({ listKey: '2026-10-13', taskId: null, index: 0 });
    });
});

describe('shiftCursorWeeks', () => {
    it('keeps the weekday and row in another week', () => {
        expect(
            shiftCursorWeeks(
                { listKey: '2026-10-12', taskId: 'a', index: 2 },
                1,
            ),
        ).toEqual({ listKey: '2026-10-19', taskId: null, index: 2 });
        expect(
            shiftCursorWeeks(
                { listKey: '2026-10-12', taskId: 'a', index: 0 },
                -1,
            ).listKey,
        ).toBe('2026-10-05');
    });

    it('leaves a Someday cursor as it is', () => {
        const cursor = { listKey: 'someday', taskId: 's', index: 0 };

        expect(shiftCursorWeeks(cursor, 1)).toBe(cursor);
    });
});
