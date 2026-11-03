import { useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentProps, Ref } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { hasLinks } from '@/lib/planner/linkify';
import { cn } from '@/lib/utils';
import { LinkedText } from '../linked-text';

export type LinkedTextFieldHandle = {
    /** Starts editing, with the caret at the end of the text. */
    focus: () => void;
};

type Props = Omit<ComponentProps<typeof Textarea>, 'ref' | 'defaultValue'> & {
    ref?: Ref<LinkedTextFieldHandle>;
    /** The text it opens with (the field is uncontrolled). */
    defaultValue: string;
    'aria-label': string;
};

/** Focuses a text field with the caret at the end of its text. */
function focusAtEnd(field: HTMLTextAreaElement) {
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
}

/**
 * An uncontrolled text field whose web links can be opened. While it is not
 * being edited, text with links in it is shown with those links clickable (in
 * a new tab); a click anywhere else, Enter or `focus()` turns it back into
 * the field. Text without links is always the field.
 */
export function LinkedTextField({
    ref,
    defaultValue,
    className,
    onFocus,
    onBlur,
    ...props
}: Props) {
    const [text, setText] = useState(defaultValue);
    const [editing, setEditing] = useState(false);
    const fieldRef = useRef<HTMLTextAreaElement>(null);
    const focusOnMount = useRef(false);

    const startEditing = () => {
        if (fieldRef.current) {
            focusAtEnd(fieldRef.current);
        } else {
            focusOnMount.current = true;
            setEditing(true);
        }
    };

    useImperativeHandle(ref, () => ({ focus: startEditing }));

    useLayoutEffect(() => {
        if (editing && focusOnMount.current && fieldRef.current) {
            focusOnMount.current = false;
            focusAtEnd(fieldRef.current);
        }
    }, [editing]);

    if (!editing && hasLinks(text)) {
        return (
            <div
                role="textbox"
                aria-label={props['aria-label']}
                aria-multiline
                aria-readonly
                tabIndex={0}
                onClick={(event) => {
                    if (
                        !(event.target instanceof Element) ||
                        !event.target.closest('a')
                    ) {
                        startEditing();
                    }
                }}
                onKeyDown={(event) => {
                    if (
                        event.key === 'Enter' &&
                        event.target === event.currentTarget
                    ) {
                        event.preventDefault();
                        startEditing();
                    }
                }}
                className={cn(
                    'w-full cursor-text text-base break-words whitespace-pre-wrap outline-none md:text-sm',
                    className,
                )}
            >
                <LinkedText text={text} />
            </div>
        );
    }

    return (
        <Textarea
            {...props}
            ref={fieldRef}
            defaultValue={text}
            onFocus={(event) => {
                setEditing(true);
                onFocus?.(event);
            }}
            onBlur={(event) => {
                onBlur?.(event);
                // Read after the handler, which may have put text back.
                setText(event.target.value);
                setEditing(false);
            }}
            className={className}
        />
    );
}
