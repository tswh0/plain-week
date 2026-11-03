import { CircleCheck, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useTaskDialogShortcuts } from '@/hooks/use-task-dialog-shortcuts';
import { toggleDone, updateTask } from '@/lib/db/tasks';
import { deleteWithUndo } from '@/lib/planner/task-actions';
import { cn } from '@/lib/utils';
import { TaskColorPicker } from './task-color-picker';
import { TaskDatePicker } from './task-date-picker';
import {
    TaskEditorContext,
    useTaskEditor,
    useTaskEditorSession,
} from './task-editor';
import { LinkedTextField } from './linked-text-field';
import type { LinkedTextFieldHandle } from './linked-text-field';
import { TaskMoreMenu, useQuickActions } from './task-more-menu';
import { TaskRepeatPicker, canRepeat } from './task-repeat-picker';
import { TaskSubtasks } from './task-subtasks';
import { TaskTimePicker } from './task-time-picker';
import { ToolbarPickerContext } from './toolbar-picker';
import type { ToolbarPicker } from './toolbar-picker';
import { TOOLBAR_BUTTON_CLASS, ToolbarTooltip } from './toolbar-tooltip';

type Props = {
    /** The task to show (a task or occurrence id); null keeps it closed. */
    taskId: string | null;
    onClose: () => void;
};

/**
 * The task dialog. Every edit is written to the local database as it happens
 * (no save button, no network); Esc or a click outside closes it. Its own
 * keys (`useTaskDialogShortcuts`) open the toolbar's pickers and run its
 * actions.
 */
export function TaskDialog({ taskId, onClose }: Props) {
    // One session per opened task: what it shows can change id while it is
    // open (an occurrence's first change, a "this and all future" edit).
    return taskId === null ? null : (
        <TaskDialogSession key={taskId} openedId={taskId} onClose={onClose} />
    );
}

function TaskDialogSession({
    openedId,
    onClose,
}: {
    openedId: string;
    onClose: () => void;
}) {
    const { task, editor } = useTaskEditorSession(openedId);

    // Deleted here or on another device (through sync): nothing left to edit.
    useEffect(() => {
        if (task === null) {
            onClose();
        }
    }, [task, onClose]);

    return (
        <Dialog
            open={task !== null && task !== undefined}
            onOpenChange={(open) => !open && onClose()}
        >
            {editor && (
                <TaskEditorContext value={editor}>
                    <TaskDialogContent onClose={onClose} />
                </TaskEditorContext>
            )}
        </Dialog>
    );
}

function TaskDialogContent({ onClose }: { onClose: () => void }) {
    const { task, series, write, edit, askScope } = useTaskEditor();
    const contentRef = useRef<HTMLDivElement>(null);
    const titleRef = useRef<LinkedTextFieldHandle>(null);
    const notesRef = useRef<LinkedTextFieldHandle>(null);
    const [picker, setPicker] = useState<ToolbarPicker | null>(null);
    const quick = useQuickActions();

    const handleDelete = async () => {
        const scope = await askScope('delete');

        if (scope !== null) {
            write((id) => deleteWithUndo(id, scope), {
                onSaved: (deleted) => deleted && onClose(),
            });
        }
    };

    /** Focuses a text field with the caret at the end of its text. */
    const focusField = (
        field: HTMLTextAreaElement | HTMLInputElement | null,
    ) => {
        field?.focus();
        field?.setSelectionRange(field.value.length, field.value.length);
    };

    const handleShortcut = useTaskDialogShortcuts({
        // A disabled picker stays closed (and is not opened later).
        'dialog.date': () =>
            task.kind === 'series' ? false : setPicker('date'),
        'dialog.time': () => setPicker('time'),
        'dialog.repeat': () =>
            canRepeat(task, series) ? setPicker('repeat') : false,
        'dialog.color': () => setPicker('color'),
        'dialog.more': () => setPicker('more'),
        'dialog.title': () => titleRef.current?.focus(),
        'dialog.notes': () => notesRef.current?.focus(),
        'dialog.subtask': () =>
            focusField(
                contentRef.current?.querySelector<HTMLInputElement>(
                    '[data-add-subtask]',
                ) ?? null,
            ),
        'dialog.toggleDone': () =>
            write((id) => toggleDone(id), { follow: true }),
        'dialog.nextDay': () => (quick.canMove ? quick.tomorrow() : false),
        'dialog.nextWeek': () => (quick.canMove ? quick.nextWeek() : false),
        'dialog.someday': () =>
            quick.canMoveToSomeday ? quick.someday() : false,
        'dialog.duplicate': quick.duplicate,
        'dialog.delete': () => void handleDelete(),
    });

    return (
        <ToolbarPickerContext value={{ open: picker, setOpen: setPicker }}>
            <DialogContent
                ref={contentRef}
                showCloseButton={false}
                aria-describedby={undefined}
                onKeyDown={handleShortcut}
                // Focus the dialog itself: no tooltip pops up and no on-screen
                // keyboard opens on touch devices.
                onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    contentRef.current?.focus();
                }}
                // Back to the task's row, which may have moved to another day
                // since it opened the dialog (when it is not shown, Radix falls
                // back to the element that had focus).
                // A toast (the "Undo" of a move) is not outside the task.
                onInteractOutside={(event) => {
                    if (
                        event.target instanceof Element &&
                        event.target.closest('[data-sonner-toaster]')
                    ) {
                        event.preventDefault();
                    }
                }}
                onCloseAutoFocus={(event) => {
                    const row = document.querySelector<HTMLElement>(
                        `[data-task-id="${CSS.escape(task.id)}"] button`,
                    );

                    if (row) {
                        event.preventDefault();
                        row.focus();
                    }
                }}
                className="top-4 max-h-[calc(100dvh-2rem)] translate-y-0 gap-4 overflow-y-auto bg-secondary p-4 text-secondary-foreground sm:top-16 sm:max-h-[calc(100dvh-8rem)] sm:max-w-lg sm:p-6"
            >
                <DialogTitle className="sr-only">Edit task</DialogTitle>
                <div className="-mx-2 -mt-1 flex min-w-0 items-center gap-1">
                    <TaskDatePicker />
                    <TaskTimePicker />
                    <div className="ms-auto flex items-center gap-1">
                        <ToolbarTooltip label="Delete" action="dialog.delete">
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Delete"
                                onClick={handleDelete}
                                className={TOOLBAR_BUTTON_CLASS}
                            >
                                <Trash2 />
                            </Button>
                        </ToolbarTooltip>
                        <TaskRepeatPicker />
                        <TaskColorPicker />
                        <TaskMoreMenu />
                    </div>
                </div>
                {/*
              The text fields are uncontrolled (the dialog remounts per task):
              typing never waits on the database round trip, and a remote edit
              of the same field made while the dialog is open shows next time.
            */}
                <div className="mt-6 flex items-start gap-2 border-b border-foreground/30 pb-1">
                    <LinkedTextField
                        ref={titleRef}
                        aria-label="Task"
                        defaultValue={task.text}
                        rows={1}
                        onChange={(event) => {
                            // The title is one line: pasted line breaks become
                            // spaces.
                            if (/[\r\n]/.test(event.target.value)) {
                                event.target.value = event.target.value.replace(
                                    /\s*[\r\n]+\s*/g,
                                    ' ',
                                );
                            }

                            const field = event.target;
                            const text = field.value;

                            if (text.trim() !== '') {
                                edit(
                                    (id, scope) =>
                                        updateTask(id, { text }, { scope }),
                                    {
                                        onCancel: () => {
                                            field.value = task.text;
                                        },
                                    },
                                );
                            }
                        }}
                        onBlur={(event) => {
                            // A task always has text: put the saved text back.
                            if (event.target.value.trim() === '') {
                                event.target.value = task.text;
                            }
                        }}
                        onKeyDown={(event) => {
                            // The title is one paragraph: Enter moves on to notes.
                            if (
                                event.key === 'Enter' &&
                                !event.nativeEvent.isComposing
                            ) {
                                event.preventDefault();
                                notesRef.current?.focus();
                            }
                        }}
                        className={cn(
                            'min-h-0 rounded-none border-0 bg-transparent p-0 text-2xl leading-snug font-medium shadow-none focus-visible:ring-0 md:text-2xl dark:bg-transparent',
                            task.done && 'text-muted-foreground line-through',
                        )}
                    />
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={
                            task.done ? 'Mark as not done' : 'Mark as done'
                        }
                        aria-pressed={task.done}
                        onClick={() =>
                            write((id) => toggleDone(id), { follow: true })
                        }
                        className="mt-0.5 shrink-0 rounded-full hover:bg-transparent"
                    >
                        <CircleCheck
                            className={cn(
                                'size-5',
                                task.done &&
                                    'fill-muted-foreground text-background',
                            )}
                        />
                    </Button>
                </div>
                <LinkedTextField
                    ref={notesRef}
                    aria-label="Notes"
                    placeholder="Add some extra notes here…"
                    defaultValue={task.notes}
                    onChange={(event) => {
                        const field = event.target;
                        const notes = field.value;

                        edit(
                            (id, scope) => updateTask(id, { notes }, { scope }),
                            {
                                onCancel: () => {
                                    field.value = task.notes;
                                },
                            },
                        );
                    }}
                    className="min-h-10 rounded-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
                />
                <TaskSubtasks />
            </DialogContent>
        </ToolbarPickerContext>
    );
}
