import { usePage } from '@inertiajs/react';
import { EllipsisVertical, Share, SquarePlus } from 'lucide-react';
import { useMemo, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { encode } from 'uqr';
import { FloatingCard } from '@/components/floating-card';
import { Button } from '@/components/ui/button';
import { installAppStore } from '@/lib/install-app';

/** The planner's address as a QR code, drawn as one SVG path (black on white in both themes). */
function QrCode({ value }: { value: string }) {
    const { size, path } = useMemo(() => {
        const qr = encode(value, { ecc: 'M', border: 4 });
        let d = '';

        qr.data.forEach((row, y) =>
            row.forEach((dark, x) => {
                if (dark) {
                    d += `M${x} ${y}h1v1h-1z`;
                }
            }),
        );

        return { size: qr.size, path: d };
    }, [value]);

    return (
        <svg
            viewBox={`0 0 ${size} ${size}`}
            role="img"
            aria-label={`QR code for ${value}`}
            shapeRendering="crispEdges"
            className="size-36 shrink-0 rounded-xl bg-white ring-1 ring-border"
            data-test="install-app-qr"
        >
            <path d={path} fill="#000" />
        </svg>
    );
}

function Steps({ title, steps }: { title: string; steps: ReactNode[] }) {
    return (
        <section className="flex flex-col gap-2.5 rounded-2xl border-[1.5px] border-border p-4">
            <h3 className="font-semibold">{title}</h3>
            <ol className="flex flex-col gap-2 text-sm leading-normal text-muted-foreground">
                {steps.map((step, index) => (
                    <li key={index} className="flex gap-2.5">
                        <span
                            aria-hidden
                            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background"
                        >
                            {index + 1}
                        </span>
                        <span>{step}</span>
                    </li>
                ))}
            </ol>
        </section>
    );
}

/** An inline icon matching the one the browser shows. */
function StepIcon({ children }: { children: ReactNode }) {
    return (
        <span className="inline-flex translate-y-0.5 text-foreground [&_svg]:size-4">
            {children}
        </span>
    );
}

/**
 * How to install Plain Week on a phone (the PWA): a QR code with this
 * instance's address and the steps for iPhone (Safari) and Android (Chrome).
 * Opened from "Install mobile app" in the header, and once by itself on a
 * desktop's first visit (`installAppStore`).
 */
export function InstallAppCard() {
    const signedIn = Boolean(usePage().props.auth?.user);
    const doneButton = useRef<HTMLButtonElement>(null);
    const url = `${window.location.origin}/`;
    const host = window.location.host;

    return (
        <FloatingCard
            title="Plain Week on your phone"
            description={
                signedIn
                    ? 'Install it as an app: it opens from your home screen and works offline. Log in there to see the same week.'
                    : 'Install it as an app: it opens from your home screen and works offline. Without an account, your phone keeps its own planner.'
            }
            onClose={installAppStore.close}
            onOpenAutoFocus={(event) => {
                event.preventDefault();
                doneButton.current?.focus();
            }}
        >
            <div className="flex items-center gap-4">
                <QrCode value={url} />
                <p className="text-sm leading-normal text-muted-foreground">
                    Scan the code with your phone&apos;s camera, or open{' '}
                    <span className="font-semibold break-all text-foreground">
                        {host}
                    </span>{' '}
                    in its browser.
                </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <Steps
                    title="iPhone"
                    steps={[
                        'Open it in Safari.',
                        <>
                            Tap Share{' '}
                            <StepIcon>
                                <Share aria-hidden />
                            </StepIcon>
                            .
                        </>,
                        <>
                            Choose{' '}
                            <span className="font-medium text-foreground">
                                Add to Home Screen
                            </span>{' '}
                            <StepIcon>
                                <SquarePlus aria-hidden />
                            </StepIcon>
                            , then Add.
                        </>,
                    ]}
                />
                <Steps
                    title="Android"
                    steps={[
                        'Open it in Chrome.',
                        <>
                            Tap the menu{' '}
                            <StepIcon>
                                <EllipsisVertical aria-hidden />
                            </StepIcon>
                            .
                        </>,
                        <>
                            Choose{' '}
                            <span className="font-medium text-foreground">
                                Install app
                            </span>{' '}
                            (or Add to Home screen), then Install.
                        </>,
                    ]}
                />
            </div>

            <Button
                ref={doneButton}
                onClick={installAppStore.close}
                className="h-12 rounded-full bg-foreground text-base font-semibold text-background hover:bg-foreground/90"
                data-test="install-app-done"
            >
                Got it
            </Button>
        </FloatingCard>
    );
}

/** Renders the card while `installAppStore` has it open. */
export function InstallAppDialog() {
    const isOpen = useSyncExternalStore(
        installAppStore.subscribe,
        installAppStore.isOpen,
        () => false,
    );

    return isOpen ? <InstallAppCard /> : null;
}
