<?php

namespace App\Models;

use App\Casts\UtcMillisDateTime;
use App\Enums\TaskColor;
use Carbon\CarbonImmutable;
use Database\Factories\TaskFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A planner task. The client owns every field except `user_id` and `version`; timestamps are client-supplied and
 * `deleted_at` is a sync tombstone, so neither Eloquent timestamps nor soft deletes are used.
 *
 * @property string $id
 * @property int $user_id
 * @property string $text
 * @property string|null $date
 * @property int|null $someday_column
 * @property string $position
 * @property bool $done
 * @property CarbonImmutable|null $done_at
 * @property TaskColor $color
 * @property string|null $time
 * @property int|null $duration_minutes
 * @property string $notes
 * @property list<array{id: string, text: string, done: bool}> $subtasks
 * @property array{type: 'daily'|'weekly'|'monthly', every?: int, weekdays?: list<int>, day?: int, until?: string|null}|null $recurrence
 * @property string|null $series_id
 * @property string|null $occurrence_date
 * @property CarbonImmutable $created_at
 * @property CarbonImmutable $updated_at
 * @property CarbonImmutable|null $deleted_at
 * @property int $version
 */
#[Fillable([
    'id', 'text', 'date', 'someday_column', 'position', 'done', 'done_at', 'color', 'time', 'notes', 'subtasks',
    'recurrence', 'series_id', 'occurrence_date', 'created_at', 'updated_at', 'deleted_at',
    'duration_minutes',
])]
class Task extends Model
{
    /** @use HasFactory<TaskFactory> */
    use HasFactory;

    public $incrementing = false;

    public $timestamps = false;

    protected $keyType = 'string';

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'user_id' => 'integer',
            'someday_column' => 'integer',
            'duration_minutes' => 'integer',
            'done' => 'boolean',
            'done_at' => UtcMillisDateTime::class,
            'color' => TaskColor::class,
            'subtasks' => 'array',
            'recurrence' => 'array',
            'created_at' => UtcMillisDateTime::class,
            'updated_at' => UtcMillisDateTime::class,
            'deleted_at' => UtcMillisDateTime::class,
            'version' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
