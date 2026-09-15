'use client';

import { useSession, signIn, signOut } from 'next-auth/react';
import { LogIn, LogOut } from 'lucide-react';

// Purely presentational auth control (#87 foundation) -- signing in/out works
// end-to-end, but no app state (Strava settings, avoided roads, routing
// options, etc.) is tied to the account yet. That migration is separate
// follow-up work.
export function AccountButton() {
    const { data: session, status } = useSession();

    if (status === 'loading') return null;

    if (session?.user) {
        return (
            <button
                onClick={() => signOut()}
                className="flex items-center gap-1.5 pl-1 pr-2.5 py-1 bg-white border border-gray-300 rounded-full text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all hover:border-gray-400 shadow-sm"
                title={`Signed in as ${session.user.name ?? 'you'} — click to sign out`}
            >
                {session.user.image ? (
                    <img src={session.user.image} alt="" className="w-6 h-6 rounded-full" />
                ) : (
                    <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center">
                        <LogOut className="w-3.5 h-3.5 text-indigo-600" />
                    </div>
                )}
                <span className="max-w-[8rem] truncate">{session.user.name ?? 'Account'}</span>
            </button>
        );
    }

    return (
        <button
            onClick={() => signIn('strava')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all hover:border-gray-400 shadow-sm"
            title="Sign in with Strava"
        >
            <LogIn className="w-4 h-4" />
            Sign in
        </button>
    );
}
