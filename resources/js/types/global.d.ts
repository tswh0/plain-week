import type {
    Account,
    Auth,
    Integrations,
    Notifications,
    Saas,
} from '@/types/auth';
import type { FlashToast } from '@/types/ui';

declare module 'react' {
    interface InputHTMLAttributes<T> {
        passwordrules?: string;
    }
}

declare module '@inertiajs/core' {
    export interface InertiaConfig {
        flashDataType: {
            toast?: FlashToast;
            caldavCredential?: {
                name: string;
                username: string;
                password: string;
                server: string;
            };
        };
        sharedPageProps: {
            name: string;
            auth: Auth;
            saas: Saas;
            /** "Send feedback" target: a mailto: in SaaS mode, GitHub Discussions otherwise. */
            feedbackUrl: string;
            integrations: Integrations;
            notifications: Notifications;
            account: Account | null;
            sidebarOpen: boolean;
            [key: string]: unknown;
        };
    }
}
