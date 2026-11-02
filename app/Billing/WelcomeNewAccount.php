<?php

namespace App\Billing;

use App\Mail\WelcomeEmail;
use App\Models\User;
use Illuminate\Support\Facades\Mail;
use Throwable;

/**
 * Queues the welcome email the first time an account has access in SaaS mode
 * (lifetime granted or a weekly subscription stored). `users.welcomed_at` is
 * claimed with a conditional update, so the success redirect and the webhook
 * racing each other send it once. Never throws: a failure to queue is
 * reported, releases the claim (the next event tries again) and leaves the
 * billing step that called it untouched.
 */
class WelcomeNewAccount
{
    public function __invoke(User $user): void
    {
        if (! config('saas.enabled') || $user->welcomed_at !== null || ! $user->hasAccess()) {
            return;
        }

        $claimed = User::whereKey($user->getKey())
            ->whereNull('welcomed_at')
            ->update(['welcomed_at' => now()]);

        if ($claimed === 0) {
            return;
        }

        try {
            Mail::to($user)->queue(new WelcomeEmail($user));
        } catch (Throwable $e) {
            report($e);
            User::whereKey($user->getKey())->update(['welcomed_at' => null]);
        }
    }
}
