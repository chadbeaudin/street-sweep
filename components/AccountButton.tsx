'use client';

import { useEffect, useState } from 'react';
import { useSession, signIn, signOut, getProviders, type ClientSafeProvider } from 'next-auth/react';
import { LogIn, LogOut } from 'lucide-react';

// Purely presentational auth control (#87 foundation) -- signing in/out works
// end-to-end, but no app state (Strava settings, avoided roads, routing
// options, etc.) is tied to the account yet. That migration is separate
// follow-up work.
export function AccountButton() {
    const { data: session, status } = useSession();
    const [providers, setProviders] = useState<Record<string, ClientSafeProvider> | null>(null);
    const [showMenu, setShowMenu] = useState(false);

    // Only offer providers actually configured server-side (lib/auth.ts registers
    // Google conditionally on GOOGLE_CLIENT_ID/SECRET) -- avoids showing a Google
    // option that would just 404 in an environment where it isn't set up.
    useEffect(() => { getProviders().then(setProviders); }, []);

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

    const providerList = providers ? Object.values(providers) : [];

    // Only one provider configured (the common case today) -- skip the menu
    // and sign in directly, same one-click behavior as before Google existed.
    if (providerList.length <= 1) {
        const providerId = providerList[0]?.id ?? 'strava';
        return (
            <button
                onClick={() => signIn(providerId)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all hover:border-gray-400 shadow-sm"
                title={`Sign in with ${providerList[0]?.name ?? 'Strava'}`}
            >
                <LogIn className="w-4 h-4" />
                Sign in
            </button>
        );
    }

    return (
        <div className="relative">
            <button
                onClick={() => setShowMenu(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all hover:border-gray-400 shadow-sm"
                title="Sign in"
            >
                <LogIn className="w-4 h-4" />
                Sign in
            </button>
            {showMenu && (
                <>
                    <div className="fixed inset-0 z-[1001]" onClick={() => setShowMenu(false)} />
                    <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-xl z-[1002] py-1 origin-top-right overflow-hidden ring-1 ring-black ring-opacity-5">
                        {providerList.map(p => (
                            <button
                                key={p.id}
                                onClick={() => { setShowMenu(false); signIn(p.id); }}
                                className="w-full text-left px-4 py-2.5 min-h-[44px] text-sm text-gray-700 hover:bg-gray-100 flex items-center"
                            >
                                Continue with {p.name}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
