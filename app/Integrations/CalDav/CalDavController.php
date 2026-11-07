<?php

namespace App\Integrations\CalDav;

use App\Models\User;
use Carbon\CarbonImmutable;
use Closure;
use DOMDocument;
use DOMElement;
use DOMNode;
use DOMXPath;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use XMLWriter;

/**
 * A read-only CalDAV collection for the planner: one VEVENT per planner item (plain task, exception or generated
 * occurrence), all-day or 20 minutes from its time, in the user's time zone and sent in UTC.
 *
 * Discovery is the standard chain: `/.well-known/caldav` → `/dav/` (current-user-principal) → principal
 * (calendar-home-set) → calendar home → the "Plain Week" calendar. Clients read it with PROPFIND and REPORT
 * (calendar-query, calendar-multiget); there is no sync-collection, so they do a full time-range sync, which is fine
 * for a personal planner.
 */
class CalDavController
{
    /** How far a REPORT may reach. A client asking 1970–2100 gets this window, not 130 years of a daily series. */
    public const int PAST_DAYS = 365;

    public const int FUTURE_DAYS = 730;

    /** Upper bound of resources in one response, so a wide query can never take the server down. */
    public const int MAX_OBJECTS = 5000;

    public function __construct(
        private readonly CalendarObjects $objects,
    ) {}

    public function handle(Request $request, string $path = ''): Response
    {
        /** @var User $user */
        $user = $request->attributes->get('caldav_user');
        $segments = array_values(array_filter(explode('/', trim($path, '/')), fn (string $part) => $part !== ''));

        if ($request->isMethod('OPTIONS')) {
            return $this->options();
        }

        if ($segments !== [] && $segments[0] === 'principals' && count($segments) === 2 && $this->owns($user, $segments[1])) {
            return $this->principalRequest($request, $user);
        }

        if ($segments !== [] && $segments[0] === 'calendars' && count($segments) >= 2 && $this->owns($user, $segments[1])) {
            $rest = array_slice($segments, 2);

            if ($rest === []) {
                return $this->homeRequest($request, $user);
            }

            if ($rest === ['planner']) {
                return $this->calendarRequest($request, $user);
            }

            if (count($rest) === 2 && $rest[0] === 'planner') {
                return $this->objectRequest($request, $user, $rest[1]);
            }
        }

        if ($segments === []) {
            return $this->rootRequest($request, $user);
        }

        return $this->notFound();
    }

    private function options(): Response
    {
        return response('', 204, [
            'DAV' => '1, 2, 3, calendar-access',
            'Allow' => 'OPTIONS, GET, HEAD, PROPFIND, REPORT',
            'MS-Author-Via' => 'DAV',
        ]);
    }

    private function rootRequest(Request $request, User $user): Response
    {
        if (! $request->isMethod('PROPFIND')) {
            return $this->notFound();
        }

        $props = [
            '{DAV:}resourcetype' => fn (XMLWriter $x) => $this->resourcetype($x),
            '{DAV:}displayname' => fn (XMLWriter $x) => $x->writeElementNS('D', 'displayname', null, 'Plain Week'),
            '{DAV:}current-user-principal' => fn (XMLWriter $x) => $this->hrefProp($x, 'D', 'current-user-principal', $this->principalHref($user)),
        ];

        return $this->multistatus([$this->response('/dav/', $props, $this->requestedProps($request))]);
    }

    private function principalRequest(Request $request, User $user): Response
    {
        if (! $request->isMethod('PROPFIND')) {
            return $this->notFound();
        }

        $href = $this->principalHref($user);
        $props = [
            '{DAV:}resourcetype' => fn (XMLWriter $x) => $this->resourcetype($x, collection: false, principal: true),
            '{DAV:}displayname' => fn (XMLWriter $x) => $x->writeElementNS('D', 'displayname', null, $user->name),
            '{DAV:}current-user-principal' => fn (XMLWriter $x) => $this->hrefProp($x, 'D', 'current-user-principal', $href),
            '{DAV:}principal-URL' => fn (XMLWriter $x) => $this->hrefProp($x, 'D', 'principal-URL', $href),
            '{urn:ietf:params:xml:ns:caldav}calendar-home-set' => fn (XMLWriter $x) => $this->hrefProp($x, 'C', 'calendar-home-set', $this->homeHref($user)),
        ];

        return $this->multistatus([$this->response($href, $props, $this->requestedProps($request))]);
    }

    private function homeRequest(Request $request, User $user): Response
    {
        if (! $request->isMethod('PROPFIND')) {
            return $this->notFound();
        }

        $requested = $this->requestedProps($request);
        $responses = [$this->response($this->homeHref($user), $this->homeProps($user), $requested)];

        if ($this->depth($request) > 0) {
            $responses[] = $this->response($this->calendarHref($user), $this->calendarProps($user), $requested);
        }

        return $this->multistatus($responses);
    }

    private function calendarRequest(Request $request, User $user): Response
    {
        if ($request->isMethod('REPORT')) {
            return $this->report($request, $user);
        }

        if (! $request->isMethod('PROPFIND')) {
            return $this->notFound();
        }

        $requested = $this->requestedProps($request);
        $responses = [$this->response($this->calendarHref($user), $this->calendarProps($user), $requested)];

        if ($this->depth($request) > 0) {
            [$from, $to] = $this->window($user);

            foreach ($this->objects->between($user, $from, $to) as $object) {
                $responses[] = $this->response($this->objectHref($user, $object->key), $this->objectProps($object), $requested);
            }
        }

        return $this->multistatus($responses);
    }

    private function objectRequest(Request $request, User $user, string $file): Response
    {
        $file = rawurldecode($file);
        $key = str_ends_with($file, '.ics') ? substr($file, 0, -4) : $file;
        $object = $this->objects->forKey($user, $key);

        if ($object === null) {
            return $this->notFound();
        }

        if ($request->isMethod('GET')) {
            return response($object->ics, 200, [
                'Content-Type' => 'text/calendar; charset=utf-8',
                'ETag' => $object->etag,
            ]);
        }

        if (! $request->isMethod('PROPFIND')) {
            return $this->notFound();
        }

        return $this->multistatus([
            $this->response($this->objectHref($user, $object->key), $this->objectProps($object), $this->requestedProps($request)),
        ]);
    }

    private function report(Request $request, User $user): Response
    {
        $body = $request->getContent();
        $doc = new DOMDocument;

        if (trim($body) === '' || ! @$doc->loadXML($body) || $doc->documentElement === null) {
            return $this->badRequest();
        }

        $xpath = $this->xpath($doc);
        $requested = $this->requestedProps($request);
        $responses = [];

        if ($doc->documentElement->localName === 'calendar-multiget') {
            foreach ($xpath->query('/*/D:href') as $node) {
                $key = $this->keyFromHref($user, trim($node->textContent));
                $object = $key === null ? null : $this->objects->forKey($user, $key);

                if ($object !== null) {
                    $responses[] = $this->response($this->objectHref($user, $object->key), $this->objectProps($object), $requested);
                }
            }

            return $this->multistatus($responses);
        }

        if ($doc->documentElement->localName !== 'calendar-query') {
            return $this->badRequest();
        }

        $range = $this->reportedRange($user, $xpath);

        if ($range === null) {
            return $this->multistatus([]);
        }

        [$from, $to, $start, $end] = $range;

        foreach ($this->objects->between($user, $from, $to) as $object) {
            if ($object->overlaps($start, $end)) {
                $responses[] = $this->response($this->objectHref($user, $object->key), $this->objectProps($object), $requested);
            }
        }

        return $this->multistatus(array_slice($responses, 0, self::MAX_OBJECTS));
    }

    /**
     * The local dates a calendar-query asks for and the UTC instants it must overlap, clamped to the window this server
     * serves. No time-range (some clients omit it) means the whole window. Null when the query is entirely outside it.
     *
     * @return array{CarbonImmutable, CarbonImmutable, CarbonImmutable, CarbonImmutable}|null
     */
    private function reportedRange(User $user, DOMXPath $xpath): ?array
    {
        $timeZone = $user->timezoneOrDefault();
        [$min, $max] = $this->window($user);
        $node = $xpath->query('//C:time-range')->item(0);

        $start = $this->utcAttribute($node, 'start') ?? $min->utc();
        $end = $this->utcAttribute($node, 'end') ?? $max->addDay()->utc();

        if ($end->lessThanOrEqualTo($start)) {
            return null;
        }

        $from = $start->setTimezone($timeZone)->startOfDay();
        $to = $end->setTimezone($timeZone)->startOfDay();

        if ($from->greaterThan($max) || $to->lessThan($min)) {
            return null;
        }

        return [$from->max($min), $to->min($max), $start, $end];
    }

    private function utcAttribute(?DOMNode $node, string $name): ?CarbonImmutable
    {
        if (! $node instanceof DOMElement || ! $node->hasAttribute($name)) {
            return null;
        }

        $value = $node->getAttribute($name);

        foreach (['Ymd\THis\Z', 'Ymd\THis', 'Ymd'] as $format) {
            $parsed = CarbonImmutable::createFromFormat('!'.$format, $value, 'UTC');

            if ($parsed !== false) {
                return $parsed;
            }
        }

        return null;
    }

    /**
     * @return array{CarbonImmutable, CarbonImmutable}
     */
    private function window(User $user): array
    {
        $today = CarbonImmutable::now($user->timezoneOrDefault())->startOfDay();

        return [$today->subDays(self::PAST_DAYS), $today->addDays(self::FUTURE_DAYS)];
    }

    /**
     * @return array<string, Closure(XMLWriter): void>
     */
    private function homeProps(User $user): array
    {
        return [
            '{DAV:}resourcetype' => fn (XMLWriter $x) => $this->resourcetype($x),
            '{DAV:}displayname' => fn (XMLWriter $x) => $x->writeElementNS('D', 'displayname', null, 'Plain Week'),
            '{DAV:}current-user-principal' => fn (XMLWriter $x) => $this->hrefProp($x, 'D', 'current-user-principal', $this->principalHref($user)),
            '{urn:ietf:params:xml:ns:caldav}calendar-home-set' => fn (XMLWriter $x) => $this->hrefProp($x, 'C', 'calendar-home-set', $this->homeHref($user)),
        ];
    }

    /**
     * @return array<string, Closure(XMLWriter): void>
     */
    private function calendarProps(User $user): array
    {
        return [
            '{DAV:}resourcetype' => fn (XMLWriter $x) => $this->resourcetype($x, calendar: true),
            '{DAV:}displayname' => fn (XMLWriter $x) => $x->writeElementNS('D', 'displayname', null, 'Plain Week'),
            '{DAV:}current-user-principal' => fn (XMLWriter $x) => $this->hrefProp($x, 'D', 'current-user-principal', $this->principalHref($user)),
            '{DAV:}supported-report-set' => function (XMLWriter $x): void {
                $x->startElementNS('D', 'supported-report-set', null);

                foreach (['calendar-query', 'calendar-multiget'] as $name) {
                    $x->startElementNS('D', 'supported-report', null);
                    $x->startElementNS('D', 'report', null);
                    $x->writeElementNS('C', $name, null);
                    $x->endElement();
                    $x->endElement();
                }

                $x->endElement();
            },
            '{DAV:}current-user-privilege-set' => function (XMLWriter $x): void {
                $x->startElementNS('D', 'current-user-privilege-set', null);
                $x->startElementNS('D', 'privilege', null);
                $x->writeElementNS('D', 'read', null);
                $x->endElement();
                $x->endElement();
            },
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => function (XMLWriter $x): void {
                $x->startElementNS('C', 'supported-calendar-component-set', null);
                $x->startElementNS('C', 'comp', null);
                $x->writeAttribute('name', 'VEVENT');
                $x->endElement();
                $x->endElement();
            },
            '{urn:ietf:params:xml:ns:caldav}calendar-description' => fn (XMLWriter $x) => $x->writeElementNS('C', 'calendar-description', null, 'Your Plain Week tasks, as all-day or timed events.'),
            '{http://calendarserver.org/ns/}getctag' => fn (XMLWriter $x) => $x->writeElementNS('CS', 'getctag', null, $this->ctag($user)),
        ];
    }

    /**
     * @return array<string, Closure(XMLWriter): void>
     */
    private function objectProps(CalendarObject $object): array
    {
        return [
            '{DAV:}resourcetype' => fn (XMLWriter $x) => $this->resourcetype($x, collection: false),
            '{DAV:}getetag' => fn (XMLWriter $x) => $x->writeElementNS('D', 'getetag', null, $object->etag),
            '{DAV:}getcontenttype' => fn (XMLWriter $x) => $x->writeElementNS('D', 'getcontenttype', null, 'text/calendar; charset=utf-8'),
            '{DAV:}getcontentlength' => fn (XMLWriter $x) => $x->writeElementNS('D', 'getcontentlength', null, (string) strlen($object->ics)),
            '{urn:ietf:params:xml:ns:caldav}calendar-data' => fn (XMLWriter $x) => $x->writeElementNS('C', 'calendar-data', null, $object->ics),
        ];
    }

    /**
     * The props the client asked for, or null for "all supported" (empty body, allprop, propname).
     *
     * @return list<string>|null
     */
    private function requestedProps(Request $request): ?array
    {
        $body = $request->getContent();

        if (trim($body) === '') {
            return null;
        }

        $doc = new DOMDocument;

        if (! @$doc->loadXML($body)) {
            return null;
        }

        $xpath = $this->xpath($doc);

        if ($xpath->query('/*/D:allprop')->length > 0 || $xpath->query('/*/D:propname')->length > 0) {
            return null;
        }

        $props = [];

        foreach ($xpath->query('/*/D:prop/*') as $node) {
            if ($node instanceof DOMElement) {
                $props[] = '{'.$node->namespaceURI.'}'.$node->localName;
            }
        }

        return $props === [] ? null : $props;
    }

    /**
     * @param  array<string, Closure(XMLWriter): void>  $props
     * @param  list<string>|null  $requested
     */
    private function response(string $href, array $props, ?array $requested): Closure
    {
        return function (XMLWriter $x) use ($href, $props, $requested): void {
            $x->startElementNS('D', 'response', null);
            $x->writeElementNS('D', 'href', null, $href);

            $found = [];
            $missing = [];

            foreach ($requested ?? array_keys($props) as $name) {
                if (isset($props[$name])) {
                    $found[$name] = $props[$name];
                } else {
                    $missing[] = $name;
                }
            }

            $this->propstat($x, $found, 'HTTP/1.1 200 OK');

            if ($missing !== []) {
                $empty = [];

                foreach ($missing as $name) {
                    $empty[$name] = fn (XMLWriter $x) => $this->emptyProp($x, $name);
                }

                $this->propstat($x, $empty, 'HTTP/1.1 404 Not Found');
            }

            $x->endElement();
        };
    }

    /**
     * @param  array<string, Closure(XMLWriter): void>  $props
     */
    private function propstat(XMLWriter $x, array $props, string $status): void
    {
        $x->startElementNS('D', 'propstat', null);
        $x->startElementNS('D', 'prop', null);

        foreach ($props as $render) {
            $render($x);
        }

        $x->endElement();
        $x->writeElementNS('D', 'status', null, $status);
        $x->endElement();
    }

    /**
     * @param  list<Closure(XMLWriter): void>  $responses
     */
    private function multistatus(array $responses): Response
    {
        $x = new XMLWriter;
        $x->openMemory();
        $x->startDocument('1.0', 'UTF-8');
        $x->startElementNS('D', 'multistatus', 'DAV:');
        $x->writeAttributeNS('xmlns', 'C', null, 'urn:ietf:params:xml:ns:caldav');
        $x->writeAttributeNS('xmlns', 'CS', null, 'http://calendarserver.org/ns/');

        foreach ($responses as $response) {
            $response($x);
        }

        $x->endElement();
        $x->endDocument();

        return response($x->outputMemory(), 207, [
            'Content-Type' => 'application/xml; charset=utf-8',
            'Cache-Control' => 'no-cache',
        ]);
    }

    private function resourcetype(XMLWriter $x, bool $collection = true, bool $calendar = false, bool $principal = false): void
    {
        $x->startElementNS('D', 'resourcetype', null);

        if ($collection) {
            $x->writeElementNS('D', 'collection', null);
        }

        if ($calendar) {
            $x->writeElementNS('C', 'calendar', null);
        }

        if ($principal) {
            $x->writeElementNS('D', 'principal', null);
        }

        $x->endElement();
    }

    private function hrefProp(XMLWriter $x, string $prefix, string $name, string $href): void
    {
        $x->startElementNS($prefix, $name, null);
        $x->writeElementNS('D', 'href', null, $href);
        $x->endElement();
    }

    /**
     * An unsupported property, named in a 404 propstat (RFC 4918 §9.1).
     */
    private function emptyProp(XMLWriter $x, string $name): void
    {
        preg_match('/^\{(.+)\}(.+)$/', $name, $matches);
        $prefix = match ($matches[1] ?? '') {
            'DAV:' => 'D',
            'urn:ietf:params:xml:ns:caldav' => 'C',
            'http://calendarserver.org/ns/' => 'CS',
            default => null,
        };

        $x->writeElementNS($prefix, $matches[2] ?? $name, null);
    }

    private function depth(Request $request): int
    {
        $depth = strtolower(trim((string) $request->header('Depth', '0')));

        return $depth === '1' || $depth === 'infinity' ? 1 : 0;
    }

    private function ctag(User $user): string
    {
        return 'ctag-'.(string) $user->tasks()->max('version');
    }

    private function xpath(DOMDocument $doc): DOMXPath
    {
        $xpath = new DOMXPath($doc);
        $xpath->registerNamespace('D', 'DAV:');
        $xpath->registerNamespace('C', 'urn:ietf:params:xml:ns:caldav');
        $xpath->registerNamespace('CS', 'http://calendarserver.org/ns/');

        return $xpath;
    }

    private function owns(User $user, string $id): bool
    {
        return (string) $user->id === $id;
    }

    private function principalHref(User $user): string
    {
        return '/dav/principals/'.$user->id.'/';
    }

    private function homeHref(User $user): string
    {
        return '/dav/calendars/'.$user->id.'/';
    }

    private function calendarHref(User $user): string
    {
        return $this->homeHref($user).'planner/';
    }

    private function objectHref(User $user, string $key): string
    {
        return $this->calendarHref($user).rawurlencode($key).'.ics';
    }

    private function keyFromHref(User $user, string $href): ?string
    {
        $prefix = $this->calendarHref($user);
        $path = parse_url($href, PHP_URL_PATH);

        if (! is_string($path) || ! str_starts_with($path, $prefix)) {
            return null;
        }

        $file = rawurldecode(substr($path, strlen($prefix)));

        return str_ends_with($file, '.ics') ? substr($file, 0, -4) : $file;
    }

    private function notFound(): Response
    {
        return response('Not Found', 404);
    }

    private function badRequest(): Response
    {
        return response('Bad Request', 400);
    }
}
