import path from 'node:path';
import type { WebpackOverrideFn } from '@remotion/bundler';
import { enableTailwind } from '@remotion/tailwind-v4';

// The Remotion CLI compiles this file elsewhere, so neither __dirname nor
// import.meta point here: the package scripts run from video/.
const videoRoot = process.cwd();

/** Tailwind v4, and the app's components and helpers through `@/`. */
export const webpackOverride: WebpackOverrideFn = (config) => {
    const withTailwind = enableTailwind(config);

    return {
        ...withTailwind,
        resolve: {
            ...withTailwind.resolve,
            alias: {
                ...withTailwind.resolve?.alias,
                '@': path.resolve(videoRoot, '../resources/js'),
                // App files resolve packages from the root node_modules: one
                // React (and one lucide) for the whole bundle.
                react: path.resolve(videoRoot, 'node_modules/react'),
                'react-dom': path.resolve(videoRoot, 'node_modules/react-dom'),
                'lucide-react': path.resolve(
                    videoRoot,
                    'node_modules/lucide-react',
                ),
            },
        },
    };
};
