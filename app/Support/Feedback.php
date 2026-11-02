<?php

namespace App\Support;

use Illuminate\Support\Str;

/**
 * Where "Send feedback" leads: an email to the operator on a SaaS instance
 * (SAAS_CONTACT_EMAIL), the project's GitHub Discussions otherwise or when no
 * real contact address is configured.
 */
final class Feedback
{
    public const DISCUSSIONS_URL = 'https://github.com/victor-falcon/plain-week/discussions';

    public const SUBJECT = 'Plain Week feedback';

    public static function url(): string
    {
        $email = (string) config('saas.seller.email');

        if (! config('saas.enabled') || ! self::isRealAddress($email)) {
            return self::DISCUSSIONS_URL;
        }

        return 'mailto:'.$email.'?subject='.rawurlencode(self::SUBJECT);
    }

    /** False for an empty address or the `example.com` placeholder of config/saas.php. */
    private static function isRealAddress(string $email): bool
    {
        return filter_var($email, FILTER_VALIDATE_EMAIL) !== false
            && ! Str::endsWith(Str::lower($email), '@example.com');
    }
}
