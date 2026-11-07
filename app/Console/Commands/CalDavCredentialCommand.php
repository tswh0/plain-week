<?php

namespace App\Console\Commands;

use App\Models\CalDavCredential;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * Creates an app password for a CalDAV client. The password is shown once; only its SHA-256 is stored.
 */
class CalDavCredentialCommand extends Command
{
    protected $signature = 'caldav:credential {email : The account email} {name=default : A label for the device}';

    protected $description = 'Create a CalDAV app password for an account';

    public function handle(): int
    {
        $email = $this->argument('email');
        $name = $this->argument('name');

        if (! is_string($email) || ! is_string($name)) {
            $this->error('Invalid arguments.');

            return self::FAILURE;
        }

        $user = User::query()->where('email', $email)->first();

        if ($user === null) {
            $this->error("No account with email {$email}.");

            return self::FAILURE;
        }

        $password = Str::random(40);

        CalDavCredential::create([
            'user_id' => $user->id,
            'name' => $name,
            'password_hash' => CalDavCredential::hash($password),
        ]);

        $this->info('CalDAV credentials for '.$user->email.':');
        $this->line('  username: '.$user->email);
        $this->line('  password: '.$password);
        $this->line('  server:   '.rtrim((string) config('app.url'), '/').'/dav/');

        return self::SUCCESS;
    }
}
