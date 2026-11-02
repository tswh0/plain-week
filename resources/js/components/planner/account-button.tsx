import { Link, usePage } from '@inertiajs/react';
import {
    ChevronDown,
    CloudUpload,
    CreditCard,
    Info,
    Keyboard,
    LogIn,
    RefreshCw,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { SendFeedbackMenuItem } from '@/components/send-feedback';
import { ShortcutHint } from '@/components/planner/shortcut-hint';
import { shortcutsDialogStore } from '@/lib/planner/shortcuts-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { UserMenuContent } from '@/components/user-menu-content';
import { useInitials } from '@/hooks/use-initials';
import { useVisibleSyncStatus } from '@/hooks/use-visible-sync-status';
import { landingStore } from '@/lib/landing';
import { syncEngine } from '@/lib/sync';
import type { SyncStatus } from '@/lib/sync';
import { cn } from '@/lib/utils';
import type { User } from '@/types';
import { login, register } from '@/routes';
import { plans } from '@/routes/billing';

/** What the dot shows: the engine's status, or `paused` when the plan ended (SaaS). */
type DotStatus = SyncStatus | 'paused';

const STATUS_LABELS: Record<DotStatus, string> = {
    idle: 'All changes synced',
    syncing: 'Syncing…',
    offline: 'Offline. Changes sync when you are back.',
    error: 'Some changes could not be synced. Click to retry.',
    paused: 'Sync paused. Renew your plan to sync again.',
};

const DOT_COLORS: Record<DotStatus, string> = {
    idle: 'bg-sync-synced',
    syncing: 'bg-sync-syncing motion-safe:animate-sync-pulse',
    offline: 'bg-sync-offline',
    error: 'bg-sync-error',
    paused: 'bg-sync-paused',
};

/** Always-visible sync status at the avatar's top-end corner. */
function StatusDot({ status }: { status: DotStatus }) {
    return (
        <span
            aria-hidden
            data-sync-status={status}
            className={cn(
                'absolute -end-px -top-px size-3.5 rounded-full border-[2.5px] border-background',
                DOT_COLORS[status],
            )}
        />
    );
}

function WithTooltip({
    label,
    children,
}: {
    label: string;
    children: ReactNode;
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>{children}</TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
        </Tooltip>
    );
}

/** Opens the shortcuts dialog; the `?` hint only shows with a mouse. */
function ShortcutsMenuItem() {
    return (
        <DropdownMenuItem
            className="cursor-pointer whitespace-nowrap"
            onSelect={shortcutsDialogStore.open}
            data-test="keyboard-shortcuts"
        >
            <Keyboard className="me-2" />
            Keyboard shortcuts
            <DropdownMenuShortcut>
                <ShortcutHint action="general.help" />
            </DropdownMenuShortcut>
        </DropdownMenuItem>
    );
}

function UserAccountMenu({ user }: { user: User }) {
    const { account } = usePage().props;
    const engineStatus = useVisibleSyncStatus();
    const getInitials = useInitials();
    // SaaS mode: without a paid plan the engine does not run (the server answers 402).
    const status: DotStatus =
        account?.hasAccess === false ? 'paused' : engineStatus;

    return (
        <DropdownMenu>
            <WithTooltip label={STATUS_LABELS[status]}>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="secondary"
                        size="icon-lg"
                        className="relative size-10 rounded-full"
                        aria-label={`Account menu. ${STATUS_LABELS[status]}`}
                        data-test="account-button"
                    >
                        <Avatar className="size-10">
                            <AvatarImage src={user.avatar} alt={user.name} />
                            <AvatarFallback className="bg-secondary text-sm font-medium text-secondary-foreground">
                                {getInitials(user.name)}
                            </AvatarFallback>
                        </Avatar>
                        <StatusDot status={status} />
                    </Button>
                </DropdownMenuTrigger>
            </WithTooltip>
            <DropdownMenuContent className="min-w-56" align="end">
                {status === 'error' && (
                    <>
                        <DropdownMenuItem
                            className="cursor-pointer"
                            onSelect={() =>
                                void syncEngine.sync({ force: true })
                            }
                            data-test="retry-sync"
                        >
                            <RefreshCw className="me-2" />
                            Retry sync
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                    </>
                )}
                {status === 'paused' && (
                    <>
                        <DropdownMenuItem asChild>
                            <Link href={plans()} className="cursor-pointer">
                                <CreditCard className="me-2" />
                                Choose a plan
                            </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                    </>
                )}
                <UserMenuContent user={user} />
                <DropdownMenuSeparator />
                <ShortcutsMenuItem />
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

const guestSegment =
    'h-10 bg-foreground text-sm font-semibold text-background hover:bg-foreground/85';

const GUEST_TOOLTIP = 'Only on this device. Sync your week across devices.';

/** Grey: nothing leaves this device yet. */
function GuestDot({ className }: { className?: string }) {
    return (
        <span
            aria-hidden
            data-sync-status="guest"
            className={cn('size-2.5 rounded-full bg-sync-paused', className)}
        />
    );
}

function GuestMenuItems({ withSignUp }: { withSignUp: boolean }) {
    const saasEnabled = usePage().props.saas?.enabled ?? false;

    return (
        <>
            {withSignUp && (
                <DropdownMenuItem asChild>
                    <Link href={register()} className="cursor-pointer">
                        <CloudUpload className="me-2" />
                        Sync your week
                    </Link>
                </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
                <Link href={login()} className="cursor-pointer">
                    <LogIn className="me-2" />
                    Log in
                </Link>
            </DropdownMenuItem>
            {saasEnabled && (
                <DropdownMenuItem
                    className="cursor-pointer"
                    onSelect={landingStore.reopen}
                    data-test="about-plain-week"
                >
                    <Info className="me-2" />
                    About Plain Week
                </DropdownMenuItem>
            )}
            <SendFeedbackMenuItem />
            <ShortcutsMenuItem />
        </>
    );
}

/**
 * Guests: "Sync your week" (to sign-up; in SaaS mode the plan choice follows)
 * with a grey dot, joined to a small menu with Log in, in SaaS mode the
 * landing card again, and Send feedback. Phones have no room for the pill next
 * to the title: a round button with the dot opens the same menu, sign-up first.
 */
function GuestSyncButton() {
    return (
        <>
            <div className="flex items-center max-sm:hidden">
                <WithTooltip label={GUEST_TOOLTIP}>
                    <Button
                        asChild
                        className={cn(
                            guestSegment,
                            'gap-2 rounded-s-full rounded-e-none ps-3 pe-4',
                        )}
                    >
                        <Link href={register()} data-test="sync-your-week">
                            <GuestDot className="ring-2 ring-background/25" />
                            Sync your week
                        </Link>
                    </Button>
                </WithTooltip>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            className={cn(
                                guestSegment,
                                'w-8 rounded-s-none rounded-e-full border-s border-s-background/20 ps-1.5 pe-2',
                            )}
                            aria-label="More account options"
                            data-test="account-button"
                        >
                            <ChevronDown className="size-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="min-w-56" align="end">
                        <GuestMenuItems withSignUp={false} />
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        className={cn(
                            guestSegment,
                            'relative size-10 rounded-full sm:hidden',
                        )}
                        aria-label={`Sync your week. ${GUEST_TOOLTIP}`}
                        data-test="guest-menu-compact"
                    >
                        <CloudUpload className="size-5" />
                        <GuestDot className="absolute -end-px -top-px size-3.5 border-[2.5px] border-background" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="min-w-56" align="end">
                    <GuestMenuItems withSignUp />
                </DropdownMenuContent>
            </DropdownMenu>
        </>
    );
}

/**
 * The account button of the planner header. Users get their menu with an
 * always-visible sync status dot; guests get "Sync your week".
 */
export function AccountButton() {
    const { auth } = usePage().props;

    return auth.user ? (
        <UserAccountMenu user={auth.user} />
    ) : (
        <GuestSyncButton />
    );
}
