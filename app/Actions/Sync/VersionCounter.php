<?php

namespace App\Actions\Sync;

use Illuminate\Support\Facades\DB;

/**
 * The single source of `tasks.version`: every write reserves a block of versions in the one sync counter, so clients
 * see one globally increasing sequence whatever wrote the row (a push, a CalDAV edit, a command).
 *
 * The counter update is the first statement of the transaction, so it takes the write lock up front: the row lock on
 * MySQL/PostgreSQL and the database write lock on SQLite. Concurrent writers therefore commit their versions in order.
 * Unused versions in a block leave gaps, which is fine: versions only have to increase.
 */
final class VersionCounter
{
    /**
     * Reserve `$count` versions and return the first one; the block is `$first`…`$first + $count - 1`.
     */
    public function reserve(int $count = 1): int
    {
        DB::table('sync_versions')->where('id', 1)->increment('value', $count);

        $last = (int) DB::table('sync_versions')->where('id', 1)->value('value');

        return $last - $count + 1;
    }
}
