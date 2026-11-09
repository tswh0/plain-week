import { Head, router, usePage } from '@inertiajs/react';
import { Check, CircleAlert, Copy } from 'lucide-react';
import { useState } from 'react';
import Heading from '@/components/heading';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { formatTimeAgo } from '@/lib/settings/relative-time';
import { cn } from '@/lib/utils';
import { edit as editIntegrations } from '@/routes/integrations';
import {
    destroy as revokeCalDav,
    store as storeCalDav,
} from '@/routes/integrations/caldav';
import { connect, destroy } from '@/routes/integrations/google';

type GoogleCalendarConnection = {
    email: string;
    broken: boolean;
    lastSyncedAt: string | null;
    lastError: string | null;
};

type CalDavCredential = {
    id: number;
    name: string;
    createdAt: string;
    lastUsedAt: string | null;
};

type CalDav = {
    server: string;
    username: string;
    credentials: CalDavCredential[];
};

type Props = {
    googleCalendar: GoogleCalendarConnection | null;
    caldav: CalDav | null;
};

function CopyButton({ value }: { value: string }) {
    const [copied, setCopied] = useState(false);

    const copy = () => {
        void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        });
    };

    return (
        <Button type="button" variant="outline" size="sm" onClick={copy}>
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy'}
        </Button>
    );
}

/**
 * One value of the connection details, with a copy button.
 */
function ConnectionField({
    label,
    value,
    mono = false,
}: {
    label: string;
    value: string;
    mono?: boolean;
}) {
    return (
        <div className="min-w-0 space-y-1.5">
            <Label>{label}</Label>
            <div className="flex items-center gap-2">
                <code
                    className={cn(
                        'min-w-0 flex-1 truncate rounded-3xl bg-muted px-3 py-1.5 text-xs',
                        mono && 'font-mono',
                    )}
                    title={value}
                >
                    {value}
                </code>
                <CopyButton value={value} />
            </div>
        </div>
    );
}

function DisconnectButton({
    connection,
}: {
    connection: GoogleCalendarConnection;
}) {
    const [open, setOpen] = useState(false);
    const [processing, setProcessing] = useState(false);

    const disconnect = () => {
        setProcessing(true);
        router.delete(destroy(), {
            preserveScroll: true,
            onFinish: () => {
                setProcessing(false);
                setOpen(false);
            },
        });
    };

    return (
        <AlertDialog
            open={open}
            onOpenChange={(next) => !processing && setOpen(next)}
        >
            <AlertDialogTrigger asChild>
                <Button variant="outline" data-test="google-disconnect">
                    Disconnect
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        Disconnect Google Calendar?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {connection.broken
                            ? `Plain Week can no longer reach ${connection.email}, so its “Plain Week” calendar stays there: delete it in Google Calendar if you don't need it. Your tasks stay in Plain Week.`
                            : `The “Plain Week” calendar is deleted from ${connection.email}. Your tasks stay in Plain Week.`}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={processing}>
                        Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                        variant="destructive"
                        disabled={processing}
                        onClick={(event) => {
                            event.preventDefault();
                            disconnect();
                        }}
                        data-test="google-disconnect-confirm"
                    >
                        {processing && <Spinner />}
                        Disconnect
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

/**
 * When the calendar last caught up with the planner, and what Google refused
 * last, if anything.
 */
function SyncState({ connection }: { connection: GoogleCalendarConnection }) {
    return (
        <CardContent className="space-y-3" data-test="google-sync-state">
            <p className="text-sm text-muted-foreground">
                {connection.lastSyncedAt === null ? (
                    'Waiting for the first sync.'
                ) : (
                    <>
                        Last synced{' '}
                        <time
                            dateTime={connection.lastSyncedAt}
                            title={new Date(
                                connection.lastSyncedAt,
                            ).toLocaleString()}
                        >
                            {formatTimeAgo(connection.lastSyncedAt)}
                        </time>
                        .
                    </>
                )}
            </p>
            {connection.lastError !== null && (
                <Alert variant="destructive" data-test="google-sync-error">
                    <CircleAlert />
                    <AlertTitle>The last sync had a problem</AlertTitle>
                    <AlertDescription>{connection.lastError}</AlertDescription>
                </Alert>
            )}
        </CardContent>
    );
}

function GoogleCalendarCard({
    connection,
}: {
    connection: GoogleCalendarConnection | null;
}) {
    return (
        <Card data-test="google-calendar">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    Google Calendar
                    {connection?.broken && (
                        <Badge variant="destructive">Needs reconnecting</Badge>
                    )}
                </CardTitle>
                <CardDescription>
                    {connection === null
                        ? 'Show your planned tasks in a “Plain Week” calendar in your Google account. Changes go one way: edit tasks here, not in Google.'
                        : connection.broken
                          ? `Google stopped accepting Plain Week's access to ${connection.email}. Reconnect to keep your calendar up to date.`
                          : `Connected to ${connection.email}. Your planned tasks show up in its “Plain Week” calendar.`}
                </CardDescription>
            </CardHeader>
            {connection !== null && !connection.broken && (
                <SyncState connection={connection} />
            )}
            <CardFooter className="gap-2">
                {(connection === null || connection.broken) && (
                    <Button asChild>
                        <a href={connect.url()} data-test="google-connect">
                            {connection === null ? 'Connect' : 'Reconnect'}
                        </a>
                    </Button>
                )}
                {connection !== null && (
                    <DisconnectButton connection={connection} />
                )}
            </CardFooter>
        </Card>
    );
}

function CredentialRow({ credential }: { credential: CalDavCredential }) {
    const [open, setOpen] = useState(false);
    const [processing, setProcessing] = useState(false);

    const revoke = () => {
        setProcessing(true);
        router.delete(revokeCalDav(credential.id), {
            preserveScroll: true,
            onFinish: () => {
                setProcessing(false);
                setOpen(false);
            },
        });
    };

    return (
        <li className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                    {credential.name}
                </p>
                <p className="text-xs text-muted-foreground">
                    Created {formatTimeAgo(credential.createdAt)}
                    {' · '}
                    {credential.lastUsedAt === null
                        ? 'Never used'
                        : `Last used ${formatTimeAgo(credential.lastUsedAt)}`}
                </p>
            </div>
            <Button
                variant="ghost"
                size="sm"
                onClick={() => setOpen(true)}
                data-test="caldav-revoke"
            >
                Revoke
            </Button>

            <AlertDialog
                open={open}
                onOpenChange={(next) => !processing && setOpen(next)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Revoke “{credential.name}”?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            The device using it stops syncing right away. You
                            can create a new app password any time.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={processing}>
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            variant="destructive"
                            disabled={processing}
                            onClick={(event) => {
                                event.preventDefault();
                                revoke();
                            }}
                            data-test="caldav-revoke-confirm"
                        >
                            {processing && <Spinner />}
                            Revoke
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </li>
    );
}

function CalDavCard({ caldav }: { caldav: CalDav }) {
    const { flash } = usePage();
    const created = flash.caldavCredential;
    const [passwordDismissed, setPasswordDismissed] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [name, setName] = useState('Calendar');
    const [processing, setProcessing] = useState(false);

    const create = () => {
        setProcessing(true);
        router.post(
            storeCalDav.url(),
            { name },
            {
                preserveScroll: true,
                onSuccess: () => {
                    setCreateOpen(false);
                    setName('Calendar');
                },
                onFinish: () => setProcessing(false),
            },
        );
    };

    return (
        <>
            <Card data-test="caldav">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        CalDAV
                        <Badge variant="secondary">Read-only</Badge>
                    </CardTitle>
                    <CardDescription>
                        Add your week to Apple Calendar, Thunderbird, DAVx5 or
                        any CalDAV client. Changes go one way: edit tasks here,
                        not in the calendar app.
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <ConnectionField label="Server" value={caldav.server} />
                        <ConnectionField
                            label="Username"
                            value={caldav.username}
                        />
                    </div>

                    {caldav.credentials.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            No app password yet. Create one, then add the server
                            above to your calendar app.
                        </p>
                    ) : (
                        <ul className="divide-y">
                            {caldav.credentials.map((credential) => (
                                <CredentialRow
                                    key={credential.id}
                                    credential={credential}
                                />
                            ))}
                        </ul>
                    )}
                </CardContent>

                <CardFooter>
                    <Button
                        onClick={() => setCreateOpen(true)}
                        data-test="caldav-create"
                    >
                        Create app password
                    </Button>
                </CardFooter>
            </Card>

            <Dialog
                open={createOpen}
                onOpenChange={(next) => !processing && setCreateOpen(next)}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create an app password</DialogTitle>
                        <DialogDescription>
                            Name it after the device or app that will use it.
                            You will see the password once.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-2">
                        <Label htmlFor="caldav-name">Name</Label>
                        <Input
                            id="caldav-name"
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            maxLength={64}
                            autoFocus
                            data-test="caldav-name"
                        />
                    </div>

                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setCreateOpen(false)}
                            disabled={processing}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={create}
                            disabled={processing || name.trim() === ''}
                            data-test="caldav-create-confirm"
                        >
                            {processing && <Spinner />}
                            Create
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog
                open={created !== undefined && !passwordDismissed}
                onOpenChange={(open) => !open && setPasswordDismissed(true)}
            >
                <DialogContent data-test="caldav-password">
                    <DialogHeader>
                        <DialogTitle>App password created</DialogTitle>
                        <DialogDescription>
                            “{created?.name}” can now connect. This password is
                            shown once: copy it into your calendar app now.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <ConnectionField
                            label="Server"
                            value={created?.server ?? ''}
                        />
                        <ConnectionField
                            label="Username"
                            value={created?.username ?? ''}
                        />
                        <ConnectionField
                            label="Password"
                            value={created?.password ?? ''}
                            mono
                        />
                    </div>

                    <DialogFooter>
                        <Button
                            onClick={() => setPasswordDismissed(true)}
                            data-test="caldav-password-done"
                        >
                            Done
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

/**
 * Settings › Integrations: optional connections to other services. Each one
 * is server-side background work and is listed only when the instance has
 * its credentials.
 */
export default function Integrations({ googleCalendar, caldav }: Props) {
    const { integrations } = usePage().props;

    return (
        <>
            <Head title="Integrations" />

            <h1 className="sr-only">Integrations</h1>

            <div className="space-y-6">
                <Heading
                    variant="small"
                    title="Integrations"
                    description="Connect Plain Week to other services"
                />

                {integrations.googleCalendar && (
                    <GoogleCalendarCard connection={googleCalendar} />
                )}

                {caldav !== null && <CalDavCard caldav={caldav} />}
            </div>
        </>
    );
}

Integrations.layout = {
    breadcrumbs: [
        {
            title: 'Integrations',
            href: editIntegrations(),
        },
    ],
};
