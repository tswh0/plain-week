import { readStorage, writeStorage } from '@/lib/storage';

/** Set once the install card was closed: it no longer opens by itself on this device. */
const SEEN_KEY = 'plain-week.install-app-seen';

const listeners = new Set<() => void>();

let open = false;
let seen = readStorage('local', SEEN_KEY) !== null;
/** The landing card was shown in this page load: the first-visit prompt waits for the next one. */
let deferred = false;

function notify() {
    listeners.forEach((listener) => listener());
}

/**
 * Whether the "Install the mobile app" card is open: an external store (for
 * `useSyncExternalStore`), so the header button and the planner page's
 * first-visit prompt can open it.
 */
export const installAppStore = {
    subscribe: (listener: () => void) => {
        listeners.add(listener);

        return () => {
            listeners.delete(listener);
        };
    },
    isOpen: () => open,
    /** "Install mobile app" in the header. */
    open: () => {
        open = true;
        notify();
    },
    /**
     * The first visit on a desktop: opens the card unless it was seen on this
     * device or `deferToNextLoad` was called in this page load.
     */
    openOnce: () => {
        if (!seen && !deferred) {
            open = true;
            notify();
        }
    },
    /** The landing card is showing: no first-visit prompt until the next page load. */
    deferToNextLoad: () => {
        deferred = true;
    },
    /** Closes the card and remembers it was seen, so it never opens by itself again. */
    close: () => {
        writeStorage('local', SEEN_KEY, '1');
        seen = true;
        open = false;
        notify();
    },
    /** Tests: back to a first visit. */
    reset: () => {
        seen = readStorage('local', SEEN_KEY) !== null;
        deferred = false;
        open = false;
        notify();
    },
};

/**
 * A desktop browser, where the card makes sense: a wide screen with a mouse,
 * not the installed app.
 */
export function isDesktopBrowser(): boolean {
    if (typeof window.matchMedia !== 'function') {
        return false;
    }

    return (
        window.matchMedia('(min-width: 1024px) and (pointer: fine)').matches &&
        !window.matchMedia('(display-mode: standalone)').matches
    );
}

/**
 * Whether a phone can open this address: not a loopback host (`localhost`,
 * `127.0.0.1`, `::1`), which on the phone would point at the phone itself.
 */
export function isReachableFromPhone(): boolean {
    const host = window.location.hostname;

    return !(
        host === 'localhost' ||
        host.endsWith('.localhost') ||
        host === '[::1]' ||
        host.startsWith('127.')
    );
}
