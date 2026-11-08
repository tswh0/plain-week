import { addDays, isoWeekday } from '@/lib/recurrence/dates';
import { db } from './database';
import { createTask, setRecurrence, toggleDone } from './tasks';
import type { CreateTaskInput } from './tasks';

type DemoTask = CreateTaskInput & { done?: boolean; repeatWeekly?: boolean };

/**
 * The onboarding tasks, in the week of `today`. Each one teaches a feature;
 * days are offsets from Monday.
 */
function demoTasks(today: string): DemoTask[] {
    const monday = addDays(today, 1 - isoWeekday(today));
    const day = (offset: number) => addDays(monday, offset);

    return [
        { text: 'Hover to complete me', date: day(0) },
        { text: 'Done looks like this', date: day(0), done: true },
        { text: 'Click a task to edit it', date: day(0) },
        { text: 'Drag me to another day', date: day(0) },
        { text: 'Pick a color in the editor', date: day(1), color: 'yellow' },
        { text: 'Times go first', date: day(1), time: '17:30' },
        { text: 'Type a date first, like 31 Dec Party', date: day(1) },
        { text: 'Right-click for actions', date: day(2) },
        { text: 'Weekly review', date: day(4), repeatWeekly: true },
        { text: 'Ideas without a date live here', date: null },
    ];
}

/**
 * Claims the onboarding for this device: true only on a guest's very first
 * visit (never seeded, never owned by a user, no tasks). It marks the device
 * as seeded either way, in one transaction, so two tabs never both seed and
 * the demo never comes back, even after the user deletes every demo task.
 */
function claimOnboarding(): Promise<boolean> {
    return db.transaction('rw', db.tasks, db.meta, async () => {
        const [seeded, owner, taskCount] = await Promise.all([
            db.meta.get('demo_seeded'),
            db.meta.get('user_id'),
            db.tasks.count(),
        ]);

        if (seeded !== undefined) {
            return false;
        }

        await db.meta.put({ key: 'demo_seeded', value: 1 });

        return owner === undefined && taskCount === 0;
    });
}

/**
 * Seeds the demo tasks in the week of `today` on a guest's very first visit,
 * through the repository. Every write marks its rows as demo in its own
 * transaction, so even a seed cut short never leaves anything to push.
 * Resolves with true when it seeded.
 */
export async function seedDemoTasks(today: string): Promise<boolean> {
    if (!(await claimOnboarding())) {
        return false;
    }

    for (const { done, repeatWeekly, ...input } of demoTasks(today)) {
        const task = await createTask(input, { demo: true });

        if (done) {
            await toggleDone(task.id, { demo: true });
        }

        if (repeatWeekly && task.date !== null) {
            await setRecurrence(
                task.id,
                { type: 'weekly', weekdays: [isoWeekday(task.date)] },
                { demo: true },
            );
        }
    }

    return true;
}
