<?php

namespace App\Actions\Sync;

use App\Models\Task;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

class PushTasks
{
    public function __construct(private readonly VersionCounter $versions) {}

    /**
     * Upsert client records for the user with last-write-wins on `updated_at`.
     *
     * Records whose id belongs to another user are rejected, and so are records without the recurrence keys (clients
     * from before v0.0.2) for a stored series or exception, and records from clients that do not understand daily
     * rules (v0.0.3 and older) for a stored daily series: those clients cannot represent them. Records older than
     * the stored row are skipped silently (they are neither applied nor rejected). Every applied record gets a fresh, globally increasing version.
     *
     * @param  list<array<string, mixed>>  $records  Validated wire records.
     * @return array{applied: list<string>, rejected: list<string>, cursor: int}
     */
    public function handle(User $user, array $records, SyncFormat $format): array
    {
        $applied = [];
        $rejected = [];

        if ($records !== []) {
            DB::transaction(function () use ($user, $records, $format, &$applied, &$rejected) {
                $nextVersion = $this->versions->reserve(count($records));

                /** @var array<string, Task> $stored */
                $stored = Task::query()
                    ->whereIn('id', array_column($records, 'id'))
                    ->get()
                    ->keyBy('id')
                    ->all();

                foreach ($records as $record) {
                    $id = $record['id'];
                    $task = $stored[$id] ?? null;

                    if ($task !== null && ($task->user_id !== $user->id || $this->isLegacyWrite($record, $task, $format))) {
                        $rejected[] = $id;

                        continue;
                    }

                    if ($task !== null && CarbonImmutable::parse($record['updated_at'], 'UTC')->lt($task->updated_at)) {
                        continue;
                    }

                    $task ??= new Task;
                    $task->fill($record);
                    $task->user_id = $user->id;
                    $task->version = $nextVersion++;
                    $task->save();

                    $stored[$id] = $task;
                    $applied[] = $id;
                }
            });
        }

        return [
            'applied' => array_values(array_unique($applied)),
            'rejected' => array_values(array_unique($rejected)),
            'cursor' => (int) $user->tasks()->max('version'),
        ];
    }

    /**
     * Whether an old client writes to a row it cannot represent.
     *
     * @param  array<string, mixed>  $record
     */
    private function isLegacyWrite(array $record, Task $task, SyncFormat $format): bool
    {
        if (! array_key_exists('recurrence', $record)) {
            return $task->recurrence !== null || $task->series_id !== null;
        }

        return ! $format->understandsDailyRules() && ($task->recurrence['type'] ?? null) === 'daily';
    }
}
