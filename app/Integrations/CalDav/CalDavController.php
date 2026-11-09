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
 * The CalDAV surface of the planner: two calendar collections, `planner` (timed tasks as VEVENT) and `tasks` (untimed
 * and Someday tasks as VTODO), read with PROPFIND and REPORT and edited with PUT and DELETE. Discovery is the standard
 * chain: `/.well-known/caldav` → `/dav/` (current-user-principal) → principal (calendar-home-set) → calendar home →
 * the collections.
 *
 * There is no sync-collection, so clients do a full time-range sync, which is fine for a personal planner. Recurring
 * series are exposed as expanded occurrences; a client edits one occurrence as an exception row, never the series.
 */
class CalDavController
{
    /** How far a REPORT may reach. A client asking 1970–2100 gets this window, not 130 years of a daily series. */
    public const int PAST_DAYS = 365;

    public const int FUTURE_DAYS = 730;

    /** Upper bound of resources in one response, so a wide query can never take the server down. */
    public const int MAX_OBJECTS = 5000;

    /** Upper bound of one PUT body; a planner item is a few kilobytes, and parsing is not free. */
    public const int MAX_BODY = 256 * 1024;

    /** Upper bound of a REPORT body and of the hrefs in one multiget, for the same reason. */
    public const int MAX_REPORT_BODY = 1024 * 1024;

    public const int MAX_MULTIGET = 1000;

    public function __construct(
        private readonly CalendarObjects $objects,
        private readonly CalendarWriter $writer,
    ) {}

    public function handle(Request $request, string $path = ''): Response
    {
        /** @var User $user */
        $user = $request->attributes->get('caldav_user');
        $segments = array_values(array_filter(explode('/', trim($path, '/')), fn (string $part) => $part !== ''));

        if ($request->isMethod('OPTIONS')) {
            return $this->options();
        }

        if ($segments === ['principals']) {
            return $this->principalsRequest($request, $user);
        }

        if ($segments !== [] && $segments[0] === 'principals' && count($segments) === 2 && $this->owns($user, $segments[1])) {
            return $this->principalRequest($request, $user);
        }

        if ($segments !== [] && $segments[0] === 'calendars' && count($segments) >= 2 && $this->owns($user, $segments[1])) {
            $rest = array_slice($segments, 2);

            if ($rest === []) {
                return $this->homeRequest($request, $user);
            }

            $collection = Collection::tryFrom($rest[0]);

            if ($collection !== null && count($rest) === 1) {
                return $this->calendarRequest($request, $user, $collection);
            }

            if ($collection !== null && count($rest) === 2) {
                return $this->objectRequest($request, $user, $collection, $rest[1]);
            }
        }

        if ($segments === []) {
            return $this->rootRequest($request, $user);
        }

        return $this->notFound();
    }

    private function options(): Response
    {
        return response('', 200, [
            'DAV' => '1, 2, 3, calendar-access',
            'Allow' => 'OPTIONS, GET, HEAD, PROPFIND, REPORT, PUT, DELETE',
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
            '{DAV:}principal-collection-set' => fn (XMLWriter $x) => $this->hrefProp($x, 'D', 'principal-collection-set', '/dav/principals/'),
        ];

        return $this->multistatus([$this->response('/dav/', $props, $this->requestedProps($request))]);
    }

    /**
     * The principal collection itself: some clients probe it before asking for `current-user-principal`.
     */
    private function principalsRequest(Request $request, User $user): Response
    {
        if (! $request->isMethod('PROPFIND')) {
            return $this->notFound();
        }

        $requested = $this->requestedProps($request);
        $responses = [$this->response('/dav/principals/', [
            '{DAV:}resourcetype' => fn (XMLWriter $x) => $this->resourcetype($x),
            '{DAV:}displayname' => fn (XMLWriter $x) => $x->writeElementNS('D', 'displayname', null, 'Principals'),
        ], $requested)];

        if ($this->depth($request) > 0) {
            $responses[] = $this->response($this->principalHref($user), $this->principalProps($user), $requested);
        }

        return $this->multistatus($responses);
    }

    private function principalRequest(Request $request, User $user): Response
    {
        if (! $request->isMethod('PROPFIND')) {
            return $this->notFound();
        }

        $href = $this->principalHref($user);

        return $this->multistatus([$this->response($href, $this->principalProps($user), $this->requestedProps($request))]);
    }

    /**
     * @return array<string, Closure(XMLWriter): mixed>
     */
    private function principalProps(User $user): array
    {
        $href = $this->principalHref($user);

        return [
            '{DAV:}resourcetype' => fn (XMLWriter $x) => $this->resourcetype($x, collection: false, principal: true),
            '{DAV:}displayname' => fn (XMLWriter $x) => $x->writeElementNS('D', 'displayname', null, $user->name),
            '{DAV:}current-user-principal' => fn (XMLWriter $x) => $this->hrefProp($x, 'D', 'current-user-principal', $href),
            '{DAV:}principal-URL' => fn (XMLWriter $x) => $this->hrefProp($x, 'D', 'principal-URL', $href),
            '{urn:ietf:params:xml:ns:caldav}calendar-home-set' => fn (XMLWriter $x) => $this->hrefProp($x, 'C', 'calendar-home-set', $this->homeHref($user)),
            // Apple's client uses this to tie the account to its email address.
            '{urn:ietf:params:xml:ns:caldav}calendar-user-address-set' => function (XMLWriter $x) use ($user): void {
                $x->startElementNS('C', 'calendar-user-address-set', null);
                $x->writeElementNS('D', 'href', null, 'mailto:'.$user->email);
                $x->endElement();
            },
        ];
    }

    private function homeRequest(Request $request, User $user): Response
    {
        if (! $request->isMethod('PROPFIND')) {
            return $this->notFound();
        }

        $requested = $this->requestedProps($request);
        $responses = [$this->response($this->homeHref($user), $this->homeProps($user), $requested)];

        if ($this->depth($request) > 0) {
            foreach (Collection::cases() as $collection) {
                $responses[] = $this->response($collection->href($user), $this->calendarProps($user, $collection), $requested);
            }
        }

        return $this->multistatus($responses);
    }

    private function calendarRequest(Request $request, User $user, Collection $collection): Response
    {
        if ($request->isMethod('REPORT')) {
            return $this->report($request, $user, $collection);
        }

        if (! $request->isMethod('PROPFIND')) {
            return $this->methodNotAllowed();
        }

        $requested = $this->requestedProps($request);
        $responses = [$this->response($collection->href($user), $this->calendarProps($user, $collection), $requested)];

        if ($this->depth($request) > 0) {
            [$from, $to] = $this->window($user);

            foreach (array_slice($this->objectsFor($user, $collection, $from, $to), 0, self::MAX_OBJECTS) as $object) {
                $responses[] = $this->response($collection->objectHref($user, $object->key), $this->objectProps($object), $requested);
            }
        }

        return $this->multistatus($responses);
    }

    private function objectRequest(Request $request, User $user, Collection $collection, string $file): Response
    {
        $file = rawurldecode($file);
        $key = str_ends_with($file, '.ics') ? substr($file, 0, -4) : $file;

        if ($request->isMethod('PUT')) {
            if (strlen($request->getContent()) > self::MAX_BODY) {
                return response('Payload Too Large', 413);
            }

            return $this->writeResponse($this->writer->put(
                $user,
                $collection,
                $key,
                $request->getContent(),
                $request->header('If-Match'),
                trim((string) $request->header('If-None-Match')) === '*',
            ));
        }

        if ($request->isMethod('DELETE')) {
            return $this->writeResponse($this->writer->delete($user, $collection, $key, $request->header('If-Match')));
        }

        $object = $this->objects->forKey($user, $collection, $key);

        if ($object === null) {
            return $this->notFound();
        }

        if ($request->isMethod('GET') || $request->isMethod('HEAD')) {
            return response($object->ics, 200, [
                'Content-Type' => 'text/calendar; charset=utf-8',
                'ETag' => $object->etag,
            ]);
        }

        if (! $request->isMethod('PROPFIND')) {
            return $this->methodNotAllowed();
        }

        return $this->multistatus([
            $this->response($collection->objectHref($user, $object->key), $this->objectProps($object), $this->requestedProps($request)),
        ]);
    }

    private function report(Request $request, User $user, Collection $collection): Response
    {
        $body = $request->getContent();

        if (strlen($body) > self::MAX_REPORT_BODY) {
            return response('Payload Too Large', 413);
        }

        $doc = new DOMDocument;

        if (trim($body) === '' || ! @$doc->loadXML($body) || $doc->documentElement === null) {
            return $this->badRequest();
        }

        $xpath = $this->xpath($doc);
        $requested = $this->requestedProps($request);
        $responses = [];

        if ($doc->documentElement->localName === 'calendar-multiget') {
            foreach (array_slice($this->nodes($xpath, '/*/D:href'), 0, self::MAX_MULTIGET) as $node) {
                $key = $this->keyFromHref($user, $collection, trim($node->textContent));
                $object = $key === null ? null : $this->objects->forKey($user, $collection, $key);

                if ($object !== null) {
                    $responses[] = $this->response($collection->objectHref($user, $object->key), $this->objectProps($object), $requested);
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

        foreach ($this->objectsFor($user, $collection, $from, $to) as $object) {
            if ($object->overlaps($start, $end)) {
                $responses[] = $this->response($collection->objectHref($user, $object->key), $this->objectProps($object), $requested);
            }
        }

        return $this->multistatus(array_slice($responses, 0, self::MAX_OBJECTS));
    }

    /**
     * @return array<string, CalendarObject>
     */
    private function objectsFor(User $user, Collection $collection, CarbonImmutable $from, CarbonImmutable $to): array
    {
        return $collection === Collection::Events
            ? $this->objects->eventsBetween($user, $from, $to)
            : $this->objects->todosBetween($user, $from, $to);
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
        $node = $this->nodes($xpath, '//C:time-range')[0] ?? null;

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

            if ($parsed instanceof CarbonImmutable) {
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
     * @return array<string, Closure(XMLWriter): mixed>
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
     * @return array<string, Closure(XMLWriter): mixed>
     */
    private function calendarProps(User $user, Collection $collection): array
    {
        return [
            '{DAV:}resourcetype' => fn (XMLWriter $x) => $this->resourcetype($x, calendar: true),
            '{DAV:}displayname' => fn (XMLWriter $x) => $x->writeElementNS('D', 'displayname', null, $collection->displayName()),
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

                foreach (['read', 'write', 'write-content', 'bind', 'unbind'] as $name) {
                    $x->startElementNS('D', 'privilege', null);
                    $x->writeElementNS('D', $name, null);
                    $x->endElement();
                }

                $x->endElement();
            },
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => function (XMLWriter $x) use ($collection): void {
                $x->startElementNS('C', 'supported-calendar-component-set', null);
                $x->startElementNS('C', 'comp', null);
                $x->writeAttribute('name', $collection->component());
                $x->endElement();
                $x->endElement();
            },
            '{urn:ietf:params:xml:ns:caldav}calendar-description' => fn (XMLWriter $x) => $x->writeElementNS('C', 'calendar-description', null, $collection->description()),
            '{http://calendarserver.org/ns/}getctag' => fn (XMLWriter $x) => $x->writeElementNS('CS', 'getctag', null, $this->ctag($user)),
        ];
    }

    /**
     * @return array<string, Closure(XMLWriter): mixed>
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

        if ($this->nodes($xpath, '/*/D:allprop') !== [] || $this->nodes($xpath, '/*/D:propname') !== []) {
            return null;
        }

        $props = [];

        foreach ($this->nodes($xpath, '/*/D:prop/*') as $node) {
            if ($node instanceof DOMElement) {
                $props[] = '{'.$node->namespaceURI.'}'.$node->localName;
            }
        }

        return $props === [] ? null : $props;
    }

    /**
     * @param  array<string, Closure(XMLWriter): mixed>  $props
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
     * @param  array<string, Closure(XMLWriter): mixed>  $props
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
     * @param  list<Closure(XMLWriter): mixed>  $responses
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

    /**
     * XPath::query() returns false on a malformed expression; this never does.
     *
     * @return list<DOMNode>
     */
    private function nodes(DOMXPath $xpath, string $expression): array
    {
        $nodes = $xpath->query($expression);

        if ($nodes === false) {
            return [];
        }

        $list = [];

        foreach ($nodes as $node) {
            if ($node instanceof DOMNode) {
                $list[] = $node;
            }
        }

        return $list;
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

    private function keyFromHref(User $user, Collection $collection, string $href): ?string
    {
        $prefix = $collection->href($user);
        $path = parse_url($href, PHP_URL_PATH);

        if (! is_string($path) || ! str_starts_with($path, $prefix)) {
            return null;
        }

        $file = rawurldecode(substr($path, strlen($prefix)));

        return str_ends_with($file, '.ics') ? substr($file, 0, -4) : $file;
    }

    private function writeResponse(WriteResult $result): Response
    {
        $headers = [];

        if ($result->object !== null) {
            $headers['ETag'] = $result->object->etag;
        }

        if ($result->location !== null) {
            $headers['Location'] = $result->location;
        }

        return response($result->status >= 400 ? $result->message : '', $result->status, $headers);
    }

    private function notFound(): Response
    {
        return response('Not Found', 404);
    }

    private function badRequest(): Response
    {
        return response('Bad Request', 400);
    }

    private function methodNotAllowed(): Response
    {
        return response('Method Not Allowed', 405, [
            'Allow' => 'OPTIONS, GET, HEAD, PROPFIND, REPORT, PUT, DELETE',
        ]);
    }
}
