import { Head, usePage } from '@inertiajs/react';
import { useEffect, useSyncExternalStore } from 'react';
import { LandingCard } from '@/components/landing/landing-card';
import {
    installAppStore,
    isDesktopBrowser,
    isReachableFromPhone,
} from '@/lib/install-app';
import { landingStore } from '@/lib/landing';

/**
 * The planner itself is the persistent `PlannerLayout` (see `app.tsx`), so
 * the sign-in, sign-up and plan pages can float over it without remounting
 * it; this page sets the title and, in SaaS mode, floats the landing card
 * over a guest's planner until they press "Start now". On a desktop's first
 * visit it opens the "Install the mobile app" card once, but never in a page
 * load that showed the landing card (that waits for the next visit) nor over
 * a task opened from a `?task=` link.
 */
export default function Planner() {
    const { auth, saas } = usePage().props;
    const dismissed = useSyncExternalStore(
        landingStore.subscribe,
        landingStore.isDismissed,
        landingStore.isDismissed,
    );
    const showLanding = (saas?.enabled ?? false) && !auth.user && !dismissed;

    useEffect(() => {
        if (showLanding) {
            installAppStore.deferToNextLoad();

            return;
        }

        // Runs before the layout's `useTaskLink` effect clears the param.
        const opensTask = new URLSearchParams(window.location.search).has(
            'task',
        );

        if (!opensTask && isDesktopBrowser() && isReachableFromPhone()) {
            installAppStore.openOnce();
        }
    }, [showLanding]);

    return (
        <>
            <Head title="Planner" />
            {showLanding && <LandingCard />}
        </>
    );
}
