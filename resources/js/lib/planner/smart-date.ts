export type ParsedTaskDate = {
    text: string;
    /** 'YYYY-MM-DD', or null when the text does not start with a date. */
    date: string | null;
};

/** Month numbers (1–12) by lowercase English and Spanish name. */
const MONTHS: Record<string, number> = {
    jan: 1,
    january: 1,
    ene: 1,
    enero: 1,
    feb: 2,
    february: 2,
    febrero: 2,
    mar: 3,
    march: 3,
    marzo: 3,
    apr: 4,
    april: 4,
    abr: 4,
    abril: 4,
    may: 5,
    mayo: 5,
    jun: 6,
    june: 6,
    junio: 6,
    jul: 7,
    july: 7,
    julio: 7,
    aug: 8,
    august: 8,
    ago: 8,
    agosto: 8,
    sep: 9,
    sept: 9,
    september: 9,
    septiembre: 9,
    setiembre: 9,
    oct: 10,
    october: 10,
    octubre: 10,
    nov: 11,
    november: 11,
    noviembre: 11,
    dec: 12,
    december: 12,
    dic: 12,
    diciembre: 12,
};

const LEADING_DATE = /^(\d{1,2})\s+(\p{L}+)\.?\s+(\S.*)$/su;

/** Years to look ahead: the longest gap between two 29 Februaries. */
const LEAP_YEAR_SEARCH = 8;

function dateKey(year: number, month: number, day: number): string {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthHasDay(year: number, month: number, day: number): boolean {
    return new Date(Date.UTC(year, month, 0)).getUTCDate() >= day;
}

/**
 * The next `day`/`month` on or after `today` ('YYYY-MM-DD'), or null when the
 * day never exists in that month.
 */
function nextOccurrence(
    day: number,
    month: number,
    today: string,
): string | null {
    const year = Number(today.slice(0, 4));

    for (let offset = 0; offset <= LEAP_YEAR_SEARCH; offset++) {
        const candidate = year + offset;

        if (!monthHasDay(candidate, month, day)) {
            continue;
        }

        const key = dateKey(candidate, month, day);

        if (key >= today) {
            return key;
        }
    }

    return null;
}

/**
 * Smart date recognition: a leading "DD MMM" date ("31 Dec Gym", "5 ene.
 * Dentist", "1 September Trip") becomes the task date and is removed from the
 * text. Month names are English or Spanish, short or full, in any case, with
 * an optional dot. The year is the next occurrence on or after `today`
 * ('YYYY-MM-DD'): today counts, a past day goes to next year and 29 February
 * to the next leap year. A date alone, an unknown month or a day the month
 * never has ("31 Feb Gym") is left in the text.
 */
export function parseSmartDate(input: string, today: string): ParsedTaskDate {
    const text = input.trim();
    const match = LEADING_DATE.exec(text);

    if (match === null) {
        return { text, date: null };
    }

    const [, dayText, monthText, rest] = match;
    const month = MONTHS[monthText.toLowerCase()];
    const day = Number(dayText);

    if (month === undefined || day < 1) {
        return { text, date: null };
    }

    const date = nextOccurrence(day, month, today);

    return date === null ? { text, date: null } : { text: rest.trim(), date };
}
