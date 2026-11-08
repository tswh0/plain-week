import { describe, expect, it } from 'vite-plus/test';
import { parseNewTaskInput } from './smart-input';

const TODAY = '2026-11-08';

describe('parseNewTaskInput', () => {
    it('reads a date then a time', () => {
        expect(parseNewTaskInput('31 Dec 17:30 Gym', TODAY)).toEqual({
            text: 'Gym',
            date: '2026-12-31',
            time: '17:30',
        });
    });

    it('reads a time then a date', () => {
        expect(parseNewTaskInput('17:30 31 dic Gym', TODAY)).toEqual({
            text: 'Gym',
            date: '2026-12-31',
            time: '17:30',
        });
    });

    it('reads a date or a time alone', () => {
        expect(parseNewTaskInput('31 Dec Gym', TODAY)).toEqual({
            text: 'Gym',
            date: '2026-12-31',
            time: null,
        });
        expect(parseNewTaskInput('9:05 Call', TODAY)).toEqual({
            text: 'Call',
            date: null,
            time: '09:05',
        });
    });

    it('takes each at most once', () => {
        expect(parseNewTaskInput('31 Dec 1 Jan Gym', TODAY)).toEqual({
            text: '1 Jan Gym',
            date: '2026-12-31',
            time: null,
        });
        expect(parseNewTaskInput('17:30 18:00 Gym', TODAY)).toEqual({
            text: '18:00 Gym',
            date: null,
            time: '17:30',
        });
    });

    it('keeps the last part as text when nothing follows it', () => {
        expect(parseNewTaskInput('31 Dec 17:30', TODAY)).toEqual({
            text: '17:30',
            date: '2026-12-31',
            time: null,
        });
    });

    it('leaves a trailing date in the text', () => {
        expect(parseNewTaskInput('Gym 31 Dec', TODAY)).toEqual({
            text: 'Gym 31 Dec',
            date: null,
            time: null,
        });
    });
});
