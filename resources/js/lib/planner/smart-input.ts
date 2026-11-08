import { parseSmartDate } from './smart-date';
import { parseSmartTime } from './smart-time';

export type ParsedNewTask = {
    text: string;
    /** 'YYYY-MM-DD', or null when the text does not start with a date. */
    date: string | null;
    /** 'HH:mm', or null when the text does not start with a time. */
    time: string | null;
};

/**
 * Reads what a new-task row was given: a leading date and a leading time, in
 * either order ("31 Dec 17:30 Gym", "17:30 31 Dec Gym"), are taken out of the
 * text. See `parseSmartDate` and `parseSmartTime`; `today` is 'YYYY-MM-DD'.
 */
export function parseNewTaskInput(input: string, today: string): ParsedNewTask {
    let text = input.trim();
    let date: string | null = null;
    let time: string | null = null;

    // Two passes, so either may come first; each is taken at most once.
    for (let pass = 0; pass < 2; pass++) {
        if (date === null) {
            ({ text, date } = parseSmartDate(text, today));
        }

        if (time === null) {
            ({ text, time } = parseSmartTime(text));
        }
    }

    return { text, date, time };
}
