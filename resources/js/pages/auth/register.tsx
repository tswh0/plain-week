import { Form, Head, usePage } from '@inertiajs/react';
import AppLogoIcon from '@/components/app-logo-icon';
import {
    AuthField,
    AuthFootnote,
    AuthSubmit,
    authInputClass,
    closeToPlanner,
} from '@/components/auth/auth-form';
import { FloatingCard } from '@/components/floating-card';
import PasswordInput from '@/components/password-input';
import TextLink from '@/components/text-link';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { login } from '@/routes';
import { privacy, terms } from '@/routes/legal';
import { store } from '@/routes/register';

type Props = {
    passwordRules: string;
};

/** "How did you hear about Plain Week?": the values match `App\Enums\ReferralSource`. */
const REFERRAL_SOURCES = [
    { value: 'x', label: 'X (Twitter)' },
    { value: 'substack', label: 'Substack newsletter' },
    { value: 'reddit', label: 'Reddit' },
    { value: 'hacker_news', label: 'Hacker News' },
    { value: 'friend', label: 'A friend' },
    { value: 'other', label: 'Other' },
] as const;

/**
 * Sign-up. In SaaS mode it is step 1 of 2: the server then sends the new
 * account to the plan choice (`/plans`).
 */
export default function Register({ passwordRules }: Props) {
    const saasEnabled = usePage().props.saas?.enabled ?? false;

    return (
        <>
            <Head title="Register" />

            <FloatingCard
                title="Create your account"
                description={
                    saasEnabled
                        ? 'Then choose how to pay. Your tasks on this device come with you.'
                        : 'Your tasks on this device come with you.'
                }
                onBack={closeToPlanner}
                onClose={closeToPlanner}
                icon={<AppLogoIcon className="size-9 shrink-0" aria-hidden />}
                toolbar={
                    saasEnabled && <span className="mx-auto">Step 1 of 2</span>
                }
            >
                <Form
                    {...store.form()}
                    resetOnSuccess={['password']}
                    disableWhileProcessing
                    className="flex flex-col gap-5"
                >
                    {({ processing, errors }) => (
                        <>
                            <AuthField
                                id="name"
                                label="Name"
                                error={errors.name}
                            >
                                <Input
                                    id="name"
                                    type="text"
                                    name="name"
                                    required
                                    autoFocus
                                    autoComplete="name"
                                    placeholder="Your name"
                                    aria-invalid={!!errors.name}
                                    className={authInputClass}
                                />
                            </AuthField>

                            <AuthField
                                id="email"
                                label="Email"
                                error={errors.email}
                            >
                                <Input
                                    id="email"
                                    type="email"
                                    name="email"
                                    required
                                    autoComplete="email"
                                    placeholder="you@example.com"
                                    aria-invalid={!!errors.email}
                                    className={authInputClass}
                                />
                            </AuthField>

                            <AuthField
                                id="password"
                                label="Password"
                                error={errors.password}
                            >
                                <PasswordInput
                                    id="password"
                                    name="password"
                                    required
                                    autoComplete="new-password"
                                    placeholder="Choose a password"
                                    passwordrules={passwordRules}
                                    aria-invalid={!!errors.password}
                                    className={authInputClass}
                                />
                            </AuthField>

                            {saasEnabled && (
                                <AuthField
                                    id="referral_source"
                                    label="How did you hear about Plain Week?"
                                    aside={
                                        <span className="text-xs text-muted-foreground">
                                            Optional
                                        </span>
                                    }
                                    error={errors.referral_source}
                                >
                                    <Select name="referral_source">
                                        <SelectTrigger
                                            id="referral_source"
                                            aria-invalid={
                                                !!errors.referral_source
                                            }
                                            // The select's own height wins over `h-11` unless matched on `data-size`.
                                            className="w-full px-4 data-[size=default]:h-11"
                                        >
                                            <SelectValue placeholder="Choose one" />
                                        </SelectTrigger>
                                        <SelectContent position="popper">
                                            {REFERRAL_SOURCES.map((source) => (
                                                <SelectItem
                                                    key={source.value}
                                                    value={source.value}
                                                >
                                                    {source.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </AuthField>
                            )}

                            <AuthSubmit
                                processing={processing}
                                data-test="register-user-button"
                            >
                                {saasEnabled ? 'Continue' : 'Create account'}
                            </AuthSubmit>
                        </>
                    )}
                </Form>

                <AuthFootnote>
                    Already have an account?{' '}
                    <TextLink href={login()}>Log in</TextLink>
                </AuthFootnote>

                {saasEnabled && (
                    <AuthFootnote className="-mt-2 text-xs">
                        By continuing you accept the{' '}
                        <TextLink
                            href={terms()}
                            className="text-muted-foreground"
                        >
                            Terms
                        </TextLink>{' '}
                        and{' '}
                        <TextLink
                            href={privacy()}
                            className="text-muted-foreground"
                        >
                            Privacy
                        </TextLink>
                        .
                    </AuthFootnote>
                )}
            </FloatingCard>
        </>
    );
}
