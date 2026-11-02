<?php

namespace App\Enums;

/**
 * Answer to "How did you hear about Plain Week?" at sign-up (SaaS mode only).
 * The values are stored, so they never change; the labels live in the register page.
 */
enum ReferralSource: string
{
    case X = 'x';
    case Substack = 'substack';
    case Reddit = 'reddit';
    case HackerNews = 'hacker_news';
    case Friend = 'friend';
    case Other = 'other';
}
