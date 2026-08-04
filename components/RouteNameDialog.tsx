'use client';

import { useState, useEffect } from 'react';
import { X, Tag, Check } from 'lucide-react';

interface RouteNameDialogProps {
    isOpen: boolean;
    initialName: string;
    onClose: () => void;
    onConfirm: (name: string) => void;
}

export function RouteNameDialog({ isOpen, initialName, onClose, onConfirm }: RouteNameDialogProps) {
    const [name, setName] = useState(initialName);

    useEffect(() => {
        if (isOpen) setName(initialName);
    }, [isOpen, initialName]);

    if (!isOpen) return null;

    const canConfirm = name.trim().length > 0;

    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                    <h2 className="text-lg font-bold text-gray-900">Name Your Route</h2>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-6 space-y-2">
                    <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                        <Tag className="w-4 h-4" /> Route Name
                    </label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && canConfirm) onConfirm(name.trim()); }}
                        placeholder="Enter a name for this route"
                        className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#FC4C02] focus:border-transparent transition-all outline-none text-gray-900"
                        autoFocus
                    />
                </div>
                <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3 bg-gray-50/50">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                        Cancel
                    </button>
                    <button
                        onClick={() => canConfirm && onConfirm(name.trim())}
                        disabled={!canConfirm}
                        className="flex items-center gap-2 px-6 py-2 bg-[#FC4C02] text-white rounded-lg text-sm font-bold hover:bg-[#e34402] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Check className="w-4 h-4" /> Continue
                    </button>
                </div>
            </div>
        </div>
    );
}
