<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // When the welcome email was claimed (SaaS mode); null until the account first gets access.
            $table->timestamp('welcomed_at')->nullable();
        });

        // Accounts that already had a plan before this column existed are not welcomed retroactively
        // (a renewal webhook would otherwise send them the email). A subscription whose first payment
        // never went through gave no access, so its account is still welcomed once it pays.
        DB::table('users')
            ->where(fn ($query) => $query
                ->whereNotNull('lifetime_purchased_at')
                ->orWhereExists(fn ($subscriptions) => $subscriptions
                    ->selectRaw('1')
                    ->from('subscriptions')
                    ->whereColumn('subscriptions.user_id', 'users.id')
                    ->whereNotIn('subscriptions.stripe_status', ['incomplete', 'incomplete_expired'])))
            ->update(['welcomed_at' => now()]);
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('welcomed_at');
        });
    }
};
