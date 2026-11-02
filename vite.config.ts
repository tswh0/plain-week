import inertia from '@inertiajs/vite';
import { wayfinder } from '@laravel/vite-plugin-wayfinder';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import laravel from 'laravel-vite-plugin';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig, lazyPlugins } from 'vite-plus';

/** Revision of a static file in `public/` for the service worker precache. */
function revisionOf(publicPath: string): string {
    return createHash('md5')
        .update(readFileSync(new URL(`./public${publicPath}`, import.meta.url)))
        .digest('hex');
}

const appVersion: string = JSON.parse(
    readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).version;

export default defineConfig({
    define: {
        __APP_VERSION__: JSON.stringify(appVersion),
    },
    // Unit tests (Vitest) only need the `@/` alias, not the Laravel and
    // Wayfinder plugins (which shell out to PHP).
    plugins: lazyPlugins(() =>
        process.env.VITEST
            ? []
            : [
                  laravel({
                      input: ['resources/css/app.css', 'resources/js/app.tsx'],
                      refresh: true,
                  }),
                  inertia(),
                  react(),
                  babel({
                      presets: [reactCompilerPreset()],
                  }),
                  tailwindcss(),
                  wayfinder({
                      formVariants: true,
                  }),
                  // Offline app shell (docs/architecture.md). The worker goes
                  // to `public/` so it is served from `/sw.js` and its scope
                  // covers the whole app; the web manifest stays in
                  // `public/build/`.
                  VitePWA({
                      strategies: 'injectManifest',
                      srcDir: 'resources/js',
                      filename: 'sw.ts',
                      outDir: 'public',
                      buildBase: '/',
                      scope: '/',
                      registerType: 'prompt',
                      injectRegister: false,
                      manifest: {
                          id: '/',
                          name: 'Plain Week',
                          short_name: 'Plain Week',
                          description:
                              'A minimal, offline-first weekly planner.',
                          start_url: '/',
                          scope: '/',
                          display: 'standalone',
                          // --background in resources/css/app.css.
                          theme_color: '#ffffff',
                          background_color: '#ffffff',
                          icons: [
                              {
                                  src: '/pwa-192x192.png',
                                  sizes: '192x192',
                                  type: 'image/png',
                              },
                              {
                                  src: '/pwa-512x512.png',
                                  sizes: '512x512',
                                  type: 'image/png',
                              },
                              {
                                  src: '/maskable-icon-512x512.png',
                                  sizes: '512x512',
                                  type: 'image/png',
                                  purpose: 'maskable',
                              },
                          ],
                      },
                      injectManifest: {
                          globDirectory: 'public/build',
                          globPatterns: ['**/*.{js,css,woff2,woff,svg,png}'],
                          modifyURLPrefix: { '': '/build/' },
                          additionalManifestEntries: [
                              {
                                  url: '/offline.html',
                                  revision: revisionOf('/offline.html'),
                              },
                          ],
                      },
                  }),
              ],
    ),
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./resources/js', import.meta.url)),
        },
    },
    server: {
        watch: {
            ignored: [
                '**/.agents/**',
                '**/.claude/**',
                '**/.cursor/**',
                '**/.junie/**',
                '**/vendor/**',
            ],
        },
    },
    test: {
        include: ['resources/js/**/*.test.{ts,tsx}'],
        environment: 'node',
        setupFiles: ['resources/js/test/setup.ts'],
    },
    lint: {
        ignorePatterns: [
            'vendor/**',
            'node_modules/**',
            'public/**',
            'bootstrap/ssr/**',
            'tailwind.config.js',
            'resources/js/actions/**',
            'resources/js/components/ui/*',
            'resources/js/routes/**',
            'resources/js/wayfinder/**',
            // The promo video is its own project with its own dependencies
            // and type check (video/README.md).
            'video/**',
        ],
        options: {
            denyWarnings: true,
            typeAware: true,
        },
    },
    fmt: {
        printWidth: 80,
        tabWidth: 4,
        singleQuote: true,
        semi: true,
        singleAttributePerLine: false,
        htmlWhitespaceSensitivity: 'css',
        ignorePatterns: [
            '.github/**',
            'composer.json',
            'resources/js/components/ui/*',
            'resources/views/mail/*',
        ],
        sortTailwindcss: {
            functions: ['clsx', 'cn', 'cva'],
            stylesheet: 'resources/css/app.css',
        },
    },
});
