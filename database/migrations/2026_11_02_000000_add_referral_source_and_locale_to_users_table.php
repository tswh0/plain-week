<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // App\Enums\ReferralSource, answered at sign-up in SaaS mode; null when skipped or self-hosted.
            $table->string('referral_source', 32)->nullable();
            // Language for emails ("en" or "es"), taken from Accept-Language at sign-up.
            $table->string('locale', 5)->nullable();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['referral_source', 'locale']);
        });
    }
};
