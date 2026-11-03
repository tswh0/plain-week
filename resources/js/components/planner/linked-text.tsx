import { linkify } from '@/lib/planner/linkify';
import { cn } from '@/lib/utils';

export const LINK_CLASS =
    'text-inherit underline decoration-current/40 underline-offset-4 transition-colors hover:decoration-current';

/** Opens a link from the planner in a new tab. */
export function openLink(href: string) {
    window.open(href, '_blank', 'noopener,noreferrer');
}

/**
 * Text with its web links as anchors that open in a new tab.
 *
 * `inButton` is for text inside a button (a task row), where an anchor is not
 * allowed: the links are underlined spans that open on click instead of
 * letting the button act.
 */
export function LinkedText({
    text,
    inButton = false,
}: {
    text: string;
    inButton?: boolean;
}) {
    return linkify(text).map((segment, index) => {
        if (segment.kind === 'text') {
            return segment.text;
        }

        return inButton ? (
            <span
                key={index}
                data-link={segment.href}
                title={segment.href}
                onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openLink(segment.href);
                }}
                className={cn(LINK_CLASS, 'cursor-pointer')}
            >
                {segment.text}
            </span>
        ) : (
            <a
                key={index}
                href={segment.href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(LINK_CLASS, 'break-all')}
            >
                {segment.text}
            </a>
        );
    });
}
