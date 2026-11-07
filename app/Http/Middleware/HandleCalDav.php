<?php

namespace App\Http\Middleware;

use App\Integrations\CalDav\CalDavAuth;
use App\Integrations\CalDav\CalDavController;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * CalDAV is a protocol, not a page: it needs PROPFIND and REPORT, which Laravel's router and Wayfinder do not know. The
 * middleware answers `/.well-known/caldav` and `/dav/*` before routing, so no DAV route reaches the router (or the
 * TypeScript helpers generated from it). Everything else passes through untouched.
 */
class HandleCalDav
{
    public function __construct(
        private readonly CalDavAuth $auth,
        private readonly EnsureCalDavAccess $access,
        private readonly CalDavController $controller,
    ) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->is('dav', 'dav/*', '.well-known/caldav')) {
            return $next($request);
        }

        abort_unless(config()->boolean('caldav.enabled'), 404);

        if ($request->is('.well-known/caldav')) {
            return redirect('/dav/', 301);
        }

        return $this->auth->handle($request, fn (Request $request) => $this->access->handle(
            $request,
            fn (Request $request) => $this->controller->handle($request, $this->path($request)),
        ));
    }

    /**
     * The path below `/dav`, which the controller parses (`calendars/1/planner/...`).
     */
    private function path(Request $request): string
    {
        return trim(substr($request->path(), 3), '/');
    }
}
