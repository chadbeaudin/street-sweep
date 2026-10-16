'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { X, AlertTriangle, Loader2 } from 'lucide-react';
import { clearCachedRoads, clearCachedPrecomputedRoads } from '@/lib/stravaCache';

const CONFIRM_WORD = 'DELETE';

interface DeleteAccountDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

export function DeleteAccountDialog({ isOpen, onClose }: DeleteAccountDialogProps) {
    const [confirmText, setConfirmText] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    const close = () => {
        if (isDeleting) return;
        setConfirmText('');
        setError(null);
        onClose();
    };

    const handleDelete = async () => {
        setIsDeleting(true);
        setError(null);
        try {
            const res = await fetch('/api/account', { method: 'DELETE' });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Account deletion failed. Please try again.');
            }
            await Promise.all([clearCachedRoads(), clearCachedPrecomputedRoads()]).catch(() => {});
            try { localStorage.removeItem('strava_settings'); } catch { /* ignore */ }
            await signOut({ callbackUrl: '/' });
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Account deletion failed. Please try again.');
            setIsDeleting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                    <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-red-500" /> Delete account
                    </h2>
                    <button onClick={close} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-6 space-y-3">
                    <p className="text-sm text-gray-700 leading-relaxed">
                        This permanently deletes your StreetSweep account and everything stored for it: your
                        synced Strava activities and GPS traces, matched ridden roads, stats, and FTP history.
                        StreetSweep&apos;s access to your Strava account is also revoked.
                    </p>
                    <p className="text-sm text-gray-700 leading-relaxed">
                        Nothing on Strava itself is deleted. This can&apos;t be undone.
                    </p>
                    <label className="block text-sm text-gray-600 pt-2">
                        Type <span className="font-mono font-bold">{CONFIRM_WORD}</span> to confirm
                        <input
                            type="text"
                            value={confirmText}
                            onChange={(e) => setConfirmText(e.target.value)}
                            disabled={isDeleting}
                            autoComplete="off"
                            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                        />
                    </label>
                    {error && <p className="text-sm text-red-600">{error}</p>}
                </div>
                <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3 bg-gray-50/50">
                    <button onClick={close} disabled={isDeleting} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                        Cancel
                    </button>
                    <button
                        onClick={handleDelete}
                        disabled={confirmText !== CONFIRM_WORD || isDeleting}
                        className="flex items-center gap-2 px-6 py-2 bg-red-600 text-white rounded-lg text-sm font-bold hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isDeleting && <Loader2 className="w-4 h-4 animate-spin" />}
                        Delete account
                    </button>
                </div>
            </div>
        </div>
    );
}
