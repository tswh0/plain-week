import type { DemoTask } from './components/planner';

export type DemoDay = {
    day: string;
    weekday: string;
    isToday?: boolean;
    isWeekend?: boolean;
    tasks: DemoTask[];
};

/** The sample week of the app's screenshots (docs/images). */
export const WEEK: DemoDay[] = [
    {
        day: '12 Oct',
        weekday: 'Mon',
        tasks: [
            { text: 'Plan the week', done: true },
            { text: 'Water the plants', repeats: true },
            { text: 'Groceries' },
        ],
    },
    {
        day: '13 Oct',
        weekday: 'Tue',
        tasks: [
            { text: 'Gym', time: '17:30', repeats: true },
            { text: 'Book flights to Lisbon', color: 'yellow' },
            { text: 'Call the bank' },
        ],
    },
    {
        day: '14 Oct',
        weekday: 'Wed',
        tasks: [
            { text: 'Dentist', time: '09:00', color: 'cornflower' },
            { text: 'Read 20 pages', repeats: true },
        ],
    },
    {
        day: '15 Oct',
        weekday: 'Thu',
        isToday: true,
        tasks: [
            { text: 'Lunch with Mia', time: '13:30' },
            { text: 'Ship the release', color: 'green' },
            { text: 'Read 20 pages', repeats: true },
        ],
    },
    {
        day: '16 Oct',
        weekday: 'Fri',
        tasks: [
            { text: 'Pizza night', time: '20:00', color: 'pink' },
            { text: 'Weekly review', repeats: true },
            { text: 'Pay rent', repeats: true },
        ],
    },
    {
        day: '17 Oct',
        weekday: 'Sat',
        isWeekend: true,
        tasks: [
            { text: 'Farmers market', time: '10:00', color: 'mango' },
            { text: 'Long run', color: 'lilac' },
        ],
    },
];
