import { describe, expect, it } from 'vite-plus/test';
import { hasLinks, linkify } from '@/lib/planner/linkify';

describe('linkify', () => {
    it('keeps notes without links as one text segment', () => {
        expect(linkify('Book hotel')).toEqual([
            { kind: 'text', text: 'Book hotel' },
        ]);
        expect(linkify('')).toEqual([]);
        expect(hasLinks('Book hotel')).toBe(false);
    });

    it('splits out http and https links', () => {
        expect(
            linkify('See https://example.com/a?b=1#c and http://x.org now'),
        ).toEqual([
            { kind: 'text', text: 'See ' },
            {
                kind: 'link',
                text: 'https://example.com/a?b=1#c',
                href: 'https://example.com/a?b=1#c',
            },
            { kind: 'text', text: ' and ' },
            { kind: 'link', text: 'http://x.org', href: 'http://x.org' },
            { kind: 'text', text: ' now' },
        ]);
    });

    it('links www addresses over https', () => {
        expect(linkify('www.example.com')).toEqual([
            {
                kind: 'link',
                text: 'www.example.com',
                href: 'https://www.example.com',
            },
        ]);
    });

    it('leaves sentence punctuation and unmatched brackets out', () => {
        expect(linkify('Go to https://example.com.')[1]).toMatchObject({
            href: 'https://example.com',
        });
        expect(linkify('(see https://example.com/x), ok')).toEqual([
            { kind: 'text', text: '(see ' },
            {
                kind: 'link',
                text: 'https://example.com/x',
                href: 'https://example.com/x',
            },
            { kind: 'text', text: '), ok' },
        ]);
    });

    it('keeps brackets that are part of the URL', () => {
        expect(
            linkify('https://en.wikipedia.org/wiki/Mercury_(planet)')[0],
        ).toMatchObject({
            href: 'https://en.wikipedia.org/wiki/Mercury_(planet)',
        });
    });

    it('keeps line breaks around links', () => {
        expect(linkify('One\nhttps://a.com\nTwo')).toEqual([
            { kind: 'text', text: 'One\n' },
            { kind: 'link', text: 'https://a.com', href: 'https://a.com' },
            { kind: 'text', text: '\nTwo' },
        ]);
    });

    it('ignores a bare scheme or www', () => {
        expect(hasLinks('https:// and www.')).toBe(false);
        expect(hasLinks('no javascript:alert(1) here')).toBe(false);
    });
});
