<?php

namespace App\Http\Controllers\Settings;

use App\Http\Controllers\Controller;
use App\Models\CalDavCredential;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Inertia\Inertia;

/**
 * The app passwords a CalDAV client signs in with. The plain password is shown once, through Inertia flash data, and
 * only its SHA-256 is stored.
 */
class CalDavCredentialController extends Controller
{
    public function store(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:64'],
        ]);

        $password = Str::random(40);

        $credential = $this->user($request)->calDavCredentials()->create([
            'name' => $validated['name'],
            'password_hash' => CalDavCredential::hash($password),
        ]);

        Inertia::flash('caldavCredential', [
            'name' => $credential->name,
            'username' => $this->user($request)->email,
            'password' => $password,
            'server' => url('/dav/'),
        ]);
        Inertia::flash('toast', ['type' => 'success', 'message' => __('CalDAV app password created.')]);

        return to_route('integrations.edit');
    }

    public function destroy(Request $request, CalDavCredential $credential): RedirectResponse
    {
        abort_unless($credential->user_id === $this->user($request)->id, 404);

        $credential->delete();

        Inertia::flash('toast', ['type' => 'success', 'message' => __('CalDAV app password revoked.')]);

        return to_route('integrations.edit');
    }

    private function user(Request $request): User
    {
        /** @var User */
        return $request->user();
    }
}
