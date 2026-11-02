import { Link, usePage } from '@inertiajs/react';
import { MessageSquare } from 'lucide-react';
import type { PropsWithChildren } from 'react';
import Heading from '@/components/heading';
import { useFeedbackLink } from '@/components/send-feedback';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useCurrentUrl } from '@/hooks/use-current-url';
import { cn, toUrl } from '@/lib/utils';
import { edit as editAppearance } from '@/routes/appearance';
import { edit as editBilling } from '@/routes/billing';
import { edit as editData } from '@/routes/data';
import { edit as editIntegrations } from '@/routes/integrations';
import { edit as editNotifications } from '@/routes/notifications';
import { edit as editPreferences } from '@/routes/preferences';
import { edit } from '@/routes/profile';
import { edit as editSecurity } from '@/routes/security';
import type { NavItem } from '@/types';

type SettingsNavItem = NavItem & {
    /** Hidden when false (e.g. a feature this instance doesn't offer). */
    visible?: (props: SharedProps) => boolean;
};

type SharedProps = ReturnType<typeof usePage>['props'];

const sidebarNavItems: SettingsNavItem[] = [
    {
        title: 'Profile',
        href: edit(),
        icon: null,
    },
    {
        title: 'Security',
        href: editSecurity(),
        icon: null,
    },
    {
        title: 'Appearance',
        href: editAppearance(),
        icon: null,
    },
    {
        title: 'Preferences',
        href: editPreferences(),
        icon: null,
    },
    {
        title: 'Notifications',
        href: editNotifications(),
        icon: null,
        visible: (props) => props.notifications?.enabled ?? false,
    },
    {
        title: 'Integrations',
        href: editIntegrations(),
        icon: null,
        visible: (props) => props.integrations?.googleCalendar ?? false,
    },
    {
        title: 'Data',
        href: editData(),
        icon: null,
    },
    {
        title: 'Billing',
        href: editBilling(),
        icon: null,
        visible: (props) => props.saas?.enabled ?? false,
    },
];

export default function SettingsLayout({ children }: PropsWithChildren) {
    const { isCurrentOrParentUrl } = useCurrentUrl();
    const props = usePage().props;
    const navItems = sidebarNavItems.filter(
        (item) => item.visible?.(props) ?? true,
    );
    const feedbackLink = useFeedbackLink();

    return (
        <div className="px-4 py-6">
            <Heading
                title="Settings"
                description="Manage your profile and account settings"
            />

            <div className="flex flex-col lg:flex-row lg:space-x-12">
                <aside className="w-full max-w-xl lg:w-48">
                    <nav
                        className="flex flex-col space-y-1 space-x-0"
                        aria-label="Settings"
                    >
                        {navItems.map((item, index) => (
                            <Button
                                key={`${toUrl(item.href)}-${index}`}
                                size="sm"
                                variant="ghost"
                                asChild
                                className={cn('w-full justify-start', {
                                    'bg-muted': isCurrentOrParentUrl(item.href),
                                })}
                            >
                                <Link href={item.href}>
                                    {item.icon && (
                                        <item.icon className="h-4 w-4" />
                                    )}
                                    {item.title}
                                </Link>
                            </Button>
                        ))}
                        {feedbackLink && (
                            <>
                                <Separator className="my-2" />
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    asChild
                                    className="w-full justify-start text-muted-foreground"
                                >
                                    <a
                                        {...feedbackLink}
                                        data-test="send-feedback"
                                    >
                                        <MessageSquare className="size-4" />
                                        Send feedback
                                    </a>
                                </Button>
                            </>
                        )}
                    </nav>
                </aside>

                <Separator className="my-6 lg:hidden" />

                <div className="flex-1 md:max-w-2xl">
                    <section className="max-w-xl space-y-12">
                        {children}
                    </section>
                </div>
            </div>
        </div>
    );
}
