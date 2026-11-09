<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * In SaaS mode a lapsed account must not keep a live calendar feed. A DAV client gets `402 Payment Required`, never a
 * redirect to the paywall: it would store the HTML page as an event.
 */
class EnsureCalDavAccess
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->attributes->get('caldav_user');

        if ($user instanceof User && ! $user->hasAccess()) {
            return response('Payment Required', 402);
        }

        return $next($request);
    }
}
