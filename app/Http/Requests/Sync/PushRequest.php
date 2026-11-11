<?php

namespace App\Http\Requests\Sync;

use App\Casts\UtcMillisDateTime;
use App\Enums\TaskColor;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class PushRequest extends FormRequest
{
    /**
     * The maximum number of records accepted in one push.
     */
    public const int MAX_RECORDS = 500;

    /**
     * The largest `every` of a daily rule.
     */
    public const int MAX_EVERY_DAYS = 365;

    private const string SERIES_IS_NOT_EXCEPTION = 'A recurring task cannot be an exception of a series.';

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        $timestamp = 'date_format:'.UtcMillisDateTime::WIRE_FORMAT;

        return [
            'tasks' => ['present', 'list', 'max:'.self::MAX_RECORDS],
            'tasks.*' => ['required', 'array'],
            'tasks.*.id' => ['required', 'string', 'uuid', 'lowercase'],
            'tasks.*.text' => ['present', 'string'],
            'tasks.*.date' => ['present', 'nullable', 'date_format:Y-m-d'],
            'tasks.*.someday_column' => ['present', 'nullable', 'required_if:tasks.*.date,null', 'integer', 'between:0,2'],
            'tasks.*.position' => ['required', 'string', 'max:255'],
            'tasks.*.done' => ['required', 'boolean:strict'],
            'tasks.*.done_at' => ['present', 'nullable', $timestamp],
            'tasks.*.color' => ['required', Rule::enum(TaskColor::class)],
            'tasks.*.time' => ['present', 'nullable', 'date_format:H:i'],
            'tasks.*.duration_minutes' => ['sometimes', 'nullable', 'integer:strict', 'between:1,1440'],
            'tasks.*.notes' => ['present', 'string'],
            'tasks.*.subtasks' => ['present', 'list'],
            'tasks.*.subtasks.*' => ['required', 'array'],
            'tasks.*.subtasks.*.id' => ['required', 'string', 'max:255'],
            'tasks.*.subtasks.*.text' => ['present', 'string'],
            'tasks.*.subtasks.*.done' => ['required', 'boolean:strict'],
            // The recurrence keys are optional (all three or none) so clients from before v0.0.2 keep syncing plain
            // tasks; PushTasks refuses their writes to a series or an exception. Cross-field invariants are in after().
            'tasks.*.recurrence' => [
                'present_with:tasks.*.series_id,tasks.*.occurrence_date', 'nullable', 'array:type,every,weekdays,day,until', 'required_array_keys:type',
            ],
            'tasks.*.recurrence.type' => ['required_with:tasks.*.recurrence', 'string', 'in:daily,weekly,monthly'],
            'tasks.*.recurrence.every' => [
                'required_if:tasks.*.recurrence.type,daily', 'prohibited_unless:tasks.*.recurrence.type,daily',
                'integer:strict', 'between:1,'.self::MAX_EVERY_DAYS,
            ],
            'tasks.*.recurrence.weekdays' => [
                'required_if:tasks.*.recurrence.type,weekly', 'prohibited_unless:tasks.*.recurrence.type,weekly', 'list',
                'min:1', 'max:7',
            ],
            'tasks.*.recurrence.weekdays.*' => ['integer:strict', 'between:1,7'],
            'tasks.*.recurrence.day' => [
                'required_if:tasks.*.recurrence.type,monthly', 'prohibited_unless:tasks.*.recurrence.type,monthly',
                'integer:strict', 'between:1,31',
            ],
            'tasks.*.recurrence.until' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'tasks.*.series_id' => [
                'present_with:tasks.*.recurrence,tasks.*.occurrence_date', 'nullable', 'string', 'uuid', 'lowercase', 'different:tasks.*.id',
            ],
            'tasks.*.occurrence_date' => [
                'present_with:tasks.*.recurrence,tasks.*.series_id', 'nullable', 'date_format:Y-m-d',
            ],
            'tasks.*.created_at' => ['required', $timestamp],
            'tasks.*.updated_at' => ['required', $timestamp],
            'tasks.*.deleted_at' => ['present', 'nullable', $timestamp],
        ];
    }

    /**
     * Check the recurrence invariants that span several fields of a record.
     *
     * A row is plain (no recurrence fields), a series (`recurrence` and a `date`, no `series_id`/`occurrence_date`) or
     * an exception (`series_id` and `occurrence_date`, no `recurrence`). Tombstones skip these checks, so deleting a
     * row is never refused (for example a series ended before its start date when it is deleted from its first day).
     *
     * @return array<int, callable(Validator): void>
     */
    public function after(): array
    {
        return [
            function (Validator $validator) {
                if ($validator->errors()->isNotEmpty()) {
                    return;
                }

                /** @var list<array<string, mixed>> $records */
                $records = $validator->getData()['tasks'];

                foreach ($records as $index => $record) {
                    if ($record['deleted_at'] !== null) {
                        continue;
                    }

                    foreach ($this->recurrenceViolations($record) as $field => $message) {
                        $validator->errors()->add("tasks.{$index}.{$field}", $message);
                    }
                }
            },
        ];
    }

    /**
     * @param  array<string, mixed>  $record
     * @return array<string, string>
     */
    private function recurrenceViolations(array $record): array
    {
        /** @var array{type: string, every?: int, weekdays?: list<int>, day?: int, until?: string|null}|null $recurrence */
        $recurrence = $record['recurrence'] ?? null;
        $seriesId = $record['series_id'] ?? null;
        $occurrenceDate = $record['occurrence_date'] ?? null;

        if ($recurrence !== null) {
            return array_filter([
                'date' => $record['date'] === null ? 'A recurring task needs a date.' : null,
                'series_id' => $seriesId !== null ? self::SERIES_IS_NOT_EXCEPTION : null,
                'occurrence_date' => $occurrenceDate !== null ? self::SERIES_IS_NOT_EXCEPTION : null,
                'recurrence.weekdays' => isset($recurrence['weekdays']) && ! $this->isStrictlyAscending($recurrence['weekdays'])
                    ? 'The weekdays must be unique and sorted.' : null,
                'recurrence.until' => isset($recurrence['until']) && $record['date'] !== null && $recurrence['until'] < $record['date']
                    ? 'The end date cannot be before the task date.' : null,
            ]);
        }

        return array_filter([
            'series_id' => $seriesId === null && $occurrenceDate !== null ? 'An exception needs its series.' : null,
            'occurrence_date' => $seriesId !== null && $occurrenceDate === null ? 'An exception needs its occurrence date.' : null,
        ]);
    }

    /**
     * @param  list<int>  $values
     */
    private function isStrictlyAscending(array $values): bool
    {
        for ($i = 1; $i < count($values); $i++) {
            if ($values[$i] <= $values[$i - 1]) {
                return false;
            }
        }

        return true;
    }

    /**
     * The validated wire records.
     *
     * @return list<array<string, mixed>>
     */
    public function records(): array
    {
        /** @var list<array<string, mixed>> */
        return $this->validated('tasks');
    }
}
