<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * An app password a CalDAV client signs in with. Only its SHA-256 is stored; the plain password is shown once.
 *
 * @property int $id
 * @property int $user_id
 * @property string $name
 * @property string $password_hash
 * @property Carbon|null $last_used_at
 */
#[Fillable(['user_id', 'name', 'password_hash', 'last_used_at'])]
class CalDavCredential extends Model
{
    protected $table = 'caldav_credentials';

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'last_used_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public static function hash(string $password): string
    {
        return hash('sha256', $password);
    }
}
