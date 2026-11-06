import { router, usePage } from '@inertiajs/react';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { InstallAppDialog } from '@/components/install-app/install-app-card';
import { KeyboardCursorProvider } from '@/components/planner/keyboard-cursor';
import { PlannerDnd } from '@/components/planner/planner-dnd';
import { PlannerHeader } from '@/components/planner/planner-header';
import { ScopePromptProvider } from '@/components/planner/scope-prompt';
import { ShortcutsDialog } from '@/components/planner/shortcuts-dialog';
import { SomedaySection } from '@/components/planner/someday-section';
import { TaskDialog } from '@/components/planner/task-dialog/task-dialog';
import { WeekGrid } from '@/components/planner/week-grid';
import { SyncProvider } from '@/components/sync-provider';
import { useCarryOver } from '@/hooks/use-carry-over';
import { useGuestOnboarding } from '@/hooks/use-guest-onboarding';
import { clearTaskParam, useTaskLink } from '@/hooks/use-task-link';
import { useToday } from '@/hooks/use-today';
import { useWeekNavigation } from '@/hooks/use-week-navigation';
import { parseDateKey } from '@/lib/db/dates';
import { edit as settings } from '@/routes/profile';

/**
 * The weekly planner, as a persistent layout: the planner page renders
 * nothing on top of it, the sign-in, sign-up and plan pages render their
 * floating card over it. Moving between those pages keeps the planner
 * mounted (same week, no reload). It reads and writes only the local
 * database; sync runs in the background for signed-in users.
 */
export default function PlannerLayout({ children }: { children: ReactNode }) {
    const today = useToday();
    const navigation = useWeekNavigation(today);
    const [openTaskId, setOpenTaskId] = useState<string | null>(null);
    const closeTask = useCallback(() => {
        setOpenTaskId(null);
        clearTaskParam();
    }, []);

    const signedIn = Boolean(usePage().props.auth.user);
    const openSettings = useCallback(() => router.visit(settings()), []);

    useGuestOnboarding(today, navigation.isCurrentWeek);
    useCarryOver(today);
    // `/?task=<id>` (notifications, calendar events): show the task's week
    // (Someday: the current one) and open it, unless a task is already open.
    useTaskLink((task) => {
        if (openTaskId !== null) {
            clearTaskParam();

            return;
        }

        if (task.date === null) {
            navigation.goToToday();
        } else {
            navigation.goToWeekOf(parseDateKey(task.date));
        }

        setOpenTaskId(task.id);
    });

    return (
        <SyncProvider>
            <ScopePromptProvider>
                <KeyboardCursorProvider
                    today={today}
                    navigation={navigation}
                    onOpenTask={setOpenTaskId}
                    onOpenSettings={signedIn ? openSettings : undefined}
                >
                    <div className="flex min-h-screen flex-col bg-background text-foreground">
                        <PlannerHeader
                            weekStart={navigation.weekStart}
                            isCurrentWeek={navigation.isCurrentWeek}
                            onPreviousWeek={navigation.previousWeek}
                            onNextWeek={navigation.nextWeek}
                            onToday={navigation.goToToday}
                        />
                        <main className="flex flex-col gap-10 px-4 pt-6 pb-12 lg:gap-12 lg:px-6 lg:pt-14">
                            <PlannerDnd
                                weekStart={navigation.weekStart}
                                onPreviousWeek={navigation.previousWeek}
                                onNextWeek={navigation.nextWeek}
                            >
                                <WeekGrid
                                    weekStart={navigation.weekStart}
                                    today={today}
                                    onOpenTask={setOpenTaskId}
                                />
                                <SomedaySection
                                    weekStart={navigation.weekStart}
                                    today={today}
                                    onOpenTask={setOpenTaskId}
                                />
                            </PlannerDnd>
                        </main>
                    </div>
                    <TaskDialog taskId={openTaskId} onClose={closeTask} />
                    <ShortcutsDialog canOpenSettings={signedIn} />
                    <InstallAppDialog />
                    {children}
                </KeyboardCursorProvider>
            </ScopePromptProvider>
        </SyncProvider>
    );
}
