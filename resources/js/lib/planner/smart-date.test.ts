import { describe, expect, it } from 'vite-plus/test';
import { parseSmartDate } from './smart-date';

// A Sunday.
const TODAY = '2026-11-08';

describe('parseSmartDate', () => {
    it('extracts a leading DD MMM date', () => {
        expect(parseSmartDate('31 Dec Gym', TODAY)).toEqual({
            text: 'Gym',
            date: '2026-12-31',
        });
    });

    it('accepts a one-digit day and a zero-padded one', () => {
        expect(parseSmartDate('9 Dec a', TODAY).date).toBe('2026-12-09');
        expect(parseSmartDate('09 Dec a', TODAY).date).toBe('2026-12-09');
    });

    it('reads English and Spanish months, short or full, in any case', () => {
        expect(parseSmartDate('1 jan a', TODAY).date).toBe('2027-01-01');
        expect(parseSmartDate('1 ENE a', TODAY).date).toBe('2027-01-01');
        expect(parseSmartDate('1 abr a', TODAY).date).toBe('2027-04-01');
        expect(parseSmartDate('1 Aug a', TODAY).date).toBe('2027-08-01');
        expect(parseSmartDate('1 ago a', TODAY).date).toBe('2027-08-01');
        expect(parseSmartDate('1 Sept a', TODAY).date).toBe('2027-09-01');
        expect(parseSmartDate('1 setiembre a', TODAY).date).toBe('2027-09-01');
        expect(parseSmartDate('25 December a', TODAY).date).toBe('2026-12-25');
        expect(parseSmartDate('25 diciembre a', TODAY).date).toBe('2026-12-25');
        expect(parseSmartDate('25 dic a', TODAY).date).toBe('2026-12-25');
    });

    it('accepts a trailing dot after the month', () => {
        expect(parseSmartDate('31 dic. Cena', TODAY)).toEqual({
            text: 'Cena',
            date: '2026-12-31',
        });
    });

    it('picks the next occurrence, today included', () => {
        expect(parseSmartDate('8 Nov a', TODAY).date).toBe('2026-11-08');
        expect(parseSmartDate('7 Nov a', TODAY).date).toBe('2027-11-07');
        expect(parseSmartDate('9 Nov a', TODAY).date).toBe('2026-11-09');
    });

    it('moves 29 February to the next year that has it', () => {
        expect(parseSmartDate('29 Feb Leap', TODAY).date).toBe('2028-02-29');
        expect(parseSmartDate('29 Feb Leap', '2028-02-29').date).toBe(
            '2028-02-29',
        );
        expect(parseSmartDate('29 Feb Leap', '2028-03-01').date).toBe(
            '2032-02-29',
        );
    });

    it('leaves impossible dates and unknown months in the text', () => {
        for (const input of [
            '31 Feb Gym',
            '30 Feb Gym',
            '31 Nov Gym',
            '32 Dec Gym',
            '0 Dec Gym',
            '123 Dec Gym',
            '12 Foo Gym',
            '12 De Gym',
        ]) {
            expect(parseSmartDate(input, TODAY)).toEqual({
                text: input,
                date: null,
            });
        }
    });

    it('leaves text without a leading date untouched', () => {
        expect(parseSmartDate('Gym 31 Dec', TODAY)).toEqual({
            text: 'Gym 31 Dec',
            date: null,
        });
        expect(parseSmartDate('Dec 31 Gym', TODAY).date).toBeNull();
    });

    it('needs text after the date', () => {
        expect(parseSmartDate('31 Dec', TODAY)).toEqual({
            text: '31 Dec',
            date: null,
        });
        expect(parseSmartDate('31 Dec.  ', TODAY).date).toBeNull();
    });

    it('needs spaces around the month', () => {
        expect(parseSmartDate('31Dec Gym', TODAY).date).toBeNull();
        expect(parseSmartDate('31 DecGym', TODAY).date).toBeNull();
    });

    it('trims the text', () => {
        expect(parseSmartDate('  31  Dec   Gym  ', TODAY)).toEqual({
            text: 'Gym',
            date: '2026-12-31',
        });
    });
});
