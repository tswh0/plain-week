import { usePage } from '@inertiajs/react';
import { MessageSquare } from 'lucide-react';
import type { ComponentProps } from 'react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';

const MAILTO = 'mailto:';

/**
 * Link attributes for the shared `feedbackUrl`, or null when the page has none
 * (a page cached before the prop existed). A mailto: opens the mail app in
 * place and names the address in its tooltip, for people without one; a web
 * page (GitHub Discussions) opens in a new tab.
 */
export function useFeedbackLink(): ComponentProps<'a'> | null {
    const href = usePage().props.feedbackUrl;

    if (!href) {
        return null;
    }

    if (href.startsWith(MAILTO)) {
        return { href, title: href.slice(MAILTO.length).split('?')[0] };
    }

    return { href, target: '_blank', rel: 'noopener noreferrer' };
}

/** "Send feedback" for the account menus (signed-in users and guests). */
export function SendFeedbackMenuItem({ onClick }: { onClick?: () => void }) {
    const link = useFeedbackLink();

    if (!link) {
        return null;
    }

    return (
        <DropdownMenuItem asChild>
            <a
                {...link}
                className="block w-full cursor-pointer"
                onClick={onClick}
                data-test="send-feedback"
            >
                <MessageSquare className="me-2" />
                Send feedback
            </a>
        </DropdownMenuItem>
    );
}
