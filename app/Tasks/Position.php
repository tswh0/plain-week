<?php

namespace App\Tasks;

/**
 * Server port of the append half of `fractional-indexing` (the library the client uses): a key that sorts after the
 * last one in a list. New tasks written over CalDAV must fit the client's keys exactly, or the next drag on the phone
 * would place them wrongly.
 */
final class Position
{
    private const string DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

    private const string HEADS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

    /**
     * A key after `$key`, or the first key of a list when it is null.
     */
    public static function after(?string $key): string
    {
        if ($key === null || $key === '') {
            return 'a0';
        }

        $integer = self::integerPart($key);
        $fraction = substr($key, strlen($integer));
        $next = self::increment($integer);

        return $next ?? $integer.self::midpoint($fraction, null);
    }

    private static function integerPart(string $key): string
    {
        $length = self::integerLength($key[0]);

        if (strlen($key) < $length) {
            throw new \InvalidArgumentException("Invalid position: {$key}.");
        }

        return substr($key, 0, $length);
    }

    private static function integerLength(string $head): int
    {
        $index = strpos(self::HEADS, $head);

        if ($index === false) {
            throw new \InvalidArgumentException("Invalid position head: {$head}.");
        }

        return $index < 26 ? 26 - $index + 1 : $index - 26 + 2;
    }

    private static function increment(string $integer): ?string
    {
        $head = $integer[0];
        $trailing = '';

        for ($i = strlen($integer) - 1; $i >= 1; $i--) {
            $digit = self::digit($integer[$i]);

            if ($digit === strlen(self::DIGITS) - 1) {
                $trailing = '0'.$trailing;

                continue;
            }

            return $head.substr($integer, 1, $i - 1).substr(self::DIGITS, $digit + 1, 1).$trailing;
        }

        $index = strpos(self::HEADS, $head);

        if ($index === strlen(self::HEADS) - 1) {
            return null;
        }

        $next = substr(self::HEADS, $index + 1, 1);
        $delta = self::integerLength($next) - self::integerLength($head);

        return $next.($delta > 0 ? $trailing.'0' : ($delta < 0 ? substr($trailing, 1) : $trailing));
    }

    private static function midpoint(string $a, ?string $b): string
    {
        if ($b !== null && $a >= $b) {
            throw new \InvalidArgumentException("{$a} >= {$b}.");
        }

        if (($a !== '' && $a[strlen($a) - 1] === '0') || ($b !== null && $b !== '' && $b[strlen($b) - 1] === '0')) {
            throw new \InvalidArgumentException('A position cannot end in zero.');
        }

        if ($b !== null) {
            $n = 0;

            while (($a[$n] ?? '0') === ($b[$n] ?? '')) {
                $n++;
            }

            if ($n > 0) {
                return substr($b, 0, $n).self::midpoint(substr($a, $n), substr($b, $n));
            }
        }

        $digitA = $a === '' ? 0 : self::digit($a[0]);
        $digitB = $b === null ? strlen(self::DIGITS) : self::digit($b[0]);

        if ($digitB - $digitA > 1) {
            return substr(self::DIGITS, (int) round(0.5 * ($digitA + $digitB)), 1);
        }

        if ($b !== null && strlen($b) > 1) {
            return $b[0];
        }

        return self::DIGITS[$digitA].self::midpoint(substr($a, 1), null);
    }

    private static function digit(string $character): int
    {
        $digit = strpos(self::DIGITS, $character);

        if ($digit === false) {
            throw new \InvalidArgumentException("Invalid position digit: {$character}.");
        }

        return $digit;
    }
}
