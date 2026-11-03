/** A piece of a task's notes: plain text, or a link to open. */
export type NoteSegment =
    | { kind: 'text'; text: string }
    | { kind: 'link'; text: string; href: string };

/** `http(s)://…` or `www.…`, up to the next whitespace or angle bracket. */
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>]+/gi;

/** Punctuation that usually ends the sentence, not the URL. */
const TRAILING_PUNCTUATION = /[.,;:!?'"*_]+$/;

const CLOSING_BRACKETS: Partial<Record<string, string>> = {
    ')': '(',
    ']': '[',
    '}': '{',
};

/**
 * Drops what follows a URL rather than belonging to it: sentence punctuation
 * and a closing parenthesis or bracket that has no opening one in the URL
 * (`(see https://example.com)`).
 */
function trimUrl(candidate: string): string {
    let url = candidate;

    for (;;) {
        const trimmed = url.replace(TRAILING_PUNCTUATION, '');
        const last = trimmed.at(-1) ?? '';
        const opening = CLOSING_BRACKETS[last];
        const count = (char: string) => trimmed.split(char).length - 1;

        if (opening !== undefined && count(opening) < count(last)) {
            url = trimmed.slice(0, -1);
        } else if (trimmed === url) {
            return url;
        } else {
            url = trimmed;
        }
    }
}

/**
 * Splits notes into text and the web links in it, so they can be shown as
 * links. A `www.` address links to `https://`.
 */
export function linkify(notes: string): NoteSegment[] {
    const segments: NoteSegment[] = [];
    let index = 0;

    for (const match of notes.matchAll(URL_PATTERN)) {
        const text = trimUrl(match[0]);

        if (/^www\.$/i.test(text) || /^https?:\/\/$/i.test(text)) {
            continue;
        }

        if (match.index > index) {
            segments.push({
                kind: 'text',
                text: notes.slice(index, match.index),
            });
        }

        segments.push({
            kind: 'link',
            text,
            href: /^www\./i.test(text) ? `https://${text}` : text,
        });
        index = match.index + text.length;
    }

    if (index < notes.length) {
        segments.push({ kind: 'text', text: notes.slice(index) });
    }

    return segments;
}

/** Whether the notes have at least one link in them. */
export function hasLinks(notes: string): boolean {
    return linkify(notes).some((segment) => segment.kind === 'link');
}
