/**
 * The video's timeline: scene order and lengths, and the moments inside each
 * scene that the picture and the soundtrack share (key presses, clicks). The
 * scenes read their timings from here and scripts/music.ts writes the sound
 * effects at the same frames, so they cannot drift apart.
 *
 * All values are frames at FPS.
 */
export const FPS = 30;

/** Frames two neighbouring scenes overlap while one fades into the next. */
export const OVERLAP = 10;

export const SCENES = {
    hook: 96,
    week: 105,
    fastEntry: 140,
    dialog: 120,
    dragDrop: 132,
    repeat: 116,
    offline: 112,
    darkMode: 80,
    openSource: 126,
    endCard: 132,
} as const;

export type SceneId = keyof typeof SCENES;

export const SCENE_ORDER: SceneId[] = [
    'hook',
    'week',
    'fastEntry',
    'dialog',
    'dragDrop',
    'repeat',
    'offline',
    'darkMode',
    'openSource',
    'endCard',
];

/** The README loop: the two busiest scenes, silent. */
export const LOOP_ORDER: SceneId[] = ['fastEntry', 'dragDrop'];

export type ScheduledScene = { id: SceneId; from: number; duration: number };

/** Start frame and length of each scene, overlapping by OVERLAP. */
export function schedule(order: SceneId[]): ScheduledScene[] {
    let from = 0;

    return order.map((id) => {
        const scene = { id, from, duration: SCENES[id] };
        from += SCENES[id] - OVERLAP;

        return scene;
    });
}

export function totalFrames(order: SceneId[]): number {
    const last = schedule(order).at(-1);

    return last ? last.from + last.duration : 0;
}

/** A text typed one character every `perChar` frames from `start`. */
export type Typing = { text: string; start: number; perChar: number };

export function typingEnd(typing: Typing): number {
    return typing.start + typing.text.length * typing.perChar;
}

/** Fast entry: two tasks typed into the new-task row, each ended by Enter. */
export const FAST_ENTRY = {
    first: { text: '17:30 Gym', start: 22, perChar: 3 },
    firstEnter: 58,
    second: { text: 'Call the bank', start: 74, perChar: 2 },
    secondEnter: 108,
} satisfies Record<string, Typing | number>;

/** Task dialog: the color picker opens, green is picked, subtasks get ticked. */
export const DIALOG = {
    openPicker: 26,
    pickColor: 50,
    tickFirst: 72,
    tickSecond: 86,
} as const;

/** Drag and drop: one task to another day, another one to Someday. */
export const DRAG = {
    firstGrab: 24,
    firstDrop: 54,
    secondGrab: 74,
    secondDrop: 106,
} as const;

/** Repeat picker: Weekly, then three weekdays, then Apply. */
export const REPEAT = {
    weekly: 20,
    days: [36, 46],
    apply: 62,
} as const;

/** Offline: the dot turns amber, two tasks are typed and saved at once. */
export const OFFLINE = {
    goOffline: 14,
    first: { text: 'Pay rent', start: 34, perChar: 2 },
    firstEnter: 54,
    backOnline: 82,
} as const;

/** Light to dark: where the circle starts to grow. */
export const DARK_MODE = {
    flip: 26,
} as const;

/** Open source: the README's docker command is typed, then Enter. */
export const OPEN_SOURCE = {
    command: {
        text: [
            'docker run -d -p 127.0.0.1:8080:8080 \\',
            '  -v plainweek-storage:/app/storage \\',
            '  -e APP_KEY="base64:$(openssl rand -base64 32)" \\',
            '  ghcr.io/victor-falcon/plain-week:latest',
        ].join('\n'),
        start: 18,
        perChar: 0.33,
    },
    enter: 74,
} as const;

export type Cue = {
    /** Frame within the scene. */
    frame: number;
    kind: 'key' | 'enter' | 'click' | 'pop' | 'whoosh';
};

function keyCues(typing: Typing): Cue[] {
    return typing.text.split('').flatMap((char, index) =>
        char === ' '
            ? []
            : [
                  {
                      frame: Math.round(typing.start + index * typing.perChar),
                      kind: 'key' as const,
                  },
              ],
    );
}

/** Sound effects of each scene, in scene frames. */
export const CUES: Partial<Record<SceneId, Cue[]>> = {
    hook: [{ frame: 52, kind: 'whoosh' }],
    fastEntry: [
        ...keyCues(FAST_ENTRY.first),
        { frame: FAST_ENTRY.firstEnter, kind: 'enter' },
        ...keyCues(FAST_ENTRY.second),
        { frame: FAST_ENTRY.secondEnter, kind: 'enter' },
    ],
    dialog: [
        { frame: DIALOG.openPicker, kind: 'click' },
        { frame: DIALOG.pickColor, kind: 'click' },
        { frame: DIALOG.tickFirst, kind: 'pop' },
        { frame: DIALOG.tickSecond, kind: 'pop' },
    ],
    dragDrop: [
        { frame: DRAG.firstGrab, kind: 'click' },
        { frame: DRAG.firstDrop, kind: 'pop' },
        { frame: DRAG.secondGrab, kind: 'click' },
        { frame: DRAG.secondDrop, kind: 'pop' },
    ],
    repeat: [
        { frame: REPEAT.weekly, kind: 'click' },
        ...REPEAT.days.map((frame) => ({ frame, kind: 'click' as const })),
        { frame: REPEAT.apply, kind: 'click' },
    ],
    offline: [
        ...keyCues(OFFLINE.first),
        { frame: OFFLINE.firstEnter, kind: 'enter' },
    ],
    darkMode: [{ frame: DARK_MODE.flip, kind: 'whoosh' }],
    openSource: [
        ...keyCues(OPEN_SOURCE.command).filter((_, index) => index % 6 === 0),
        { frame: OPEN_SOURCE.enter, kind: 'enter' },
    ],
};
