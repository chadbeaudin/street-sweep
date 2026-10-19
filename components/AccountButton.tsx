'use client';

import { useState } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import { LogIn, LogOut } from 'lucide-react';
import { DeleteAccountDialog } from './DeleteAccountDialog';
import { StravaCreditToggle } from './StravaCreditToggle';

// Purely presentational auth control (#87 foundation) -- signing in/out works
// end-to-end, but no app state (Strava settings, avoided roads, routing
// options, etc.) is tied to the account yet. That migration is separate
// follow-up work.
export function AccountButton() {
    const { data: session, status } = useSession();
    const [showMenu, setShowMenu] = useState(false);
    const [showDeleteAccount, setShowDeleteAccount] = useState(false);

    if (status === 'loading') return null;

    if (session?.user) {
        return (
            <div className="relative">
                <button
                    onClick={() => setShowMenu(v => !v)}
                    className="flex items-center gap-1.5 pl-1 pr-2.5 py-1 bg-white border border-gray-300 rounded-full text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all hover:border-gray-400 shadow-sm"
                    title={`Signed in as ${session.user.name ?? 'you'}`}
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
                {showMenu && (
                    <>
                        <div className="fixed inset-0 z-[1001]" onClick={() => setShowMenu(false)} />
                        <div className="absolute right-0 mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-xl z-[1002] py-1 origin-top-right overflow-hidden ring-1 ring-black ring-opacity-5">
                            {(session.user as { isAdmin?: boolean }).isAdmin && (
                                <a
                                    href="/admin"
                                    onClick={() => setShowMenu(false)}
                                    className="w-full text-left px-4 py-2.5 min-h-[44px] text-sm text-gray-700 hover:bg-gray-100 flex items-center"
                                >
                                    Admin
                                </a>
                            )}
                            <button
                                onClick={() => { setShowMenu(false); signOut(); }}
                                className="w-full text-left px-4 py-2.5 min-h-[44px] text-sm text-gray-700 hover:bg-gray-100 flex items-center"
                            >
                                Sign out
                            </button>
                            <button
                                onClick={() => { setShowMenu(false); setShowDeleteAccount(true); }}
                                className="w-full text-left px-4 py-2.5 min-h-[44px] text-sm text-red-600 hover:bg-red-50 flex items-center"
                            >
                                Delete account
                            </button>
                            <StravaCreditToggle />
                        </div>
                    </>
                )}
                <DeleteAccountDialog isOpen={showDeleteAccount} onClose={() => setShowDeleteAccount(false)} />
            </div>
        );
    }

    // Strava is the only sign-in (#126): signing in is also what connects Strava.
    return (
        <button
            onClick={() => signIn('strava')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all hover:border-gray-400 shadow-sm"
            title="Sign in with Strava"
        >
            <LogIn className="w-4 h-4" />
            Sign in with Strava
        </button>
    );
}
