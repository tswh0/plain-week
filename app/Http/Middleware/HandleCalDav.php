<?php

namespace App\Http\Middleware;

use App\Integrations\CalDav\CalDavAuth;
use App\Integrations\CalDav\CalDavController;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
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
        $rootProbe = $request->path() === '/' && in_array($request->getMethod(), ['PROPFIND', 'OPTIONS'], true);

        if (! $rootProbe && ! $request->is('dav', 'dav/*', '.well-known/caldav')) {
            return $next($request);
        }

        abort_unless(config()->boolean('caldav.enabled'), 404);

        Log::debug('CalDAV request', [
            'method' => $request->getMethod(),
            'path' => '/'.$request->path(),
            'user_agent' => $request->userAgent(),
        ]);

        if ($request->is('.well-known/caldav')) {
            // Keep the trailing slash: some clients resolve hrefs against the redirect target.
            return redirect()->away(rtrim($request->root(), '/').'/dav/', 301);
        }

        // A capability probe: answer before asking for credentials, like every other DAV server.
        if ($request->isMethod('OPTIONS')) {
            return $this->controller->handle($request, $rootProbe ? '' : $this->path($request));
        }

        return $this->auth->handle($request, fn (Request $request) => $this->access->handle(
            $request,
            fn (Request $request) => $this->controller->handle($request, $rootProbe ? '' : $this->path($request)),
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
