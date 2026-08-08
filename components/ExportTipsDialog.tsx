'use client';

import { useState } from 'react';
import { X, Lightbulb, Check } from 'lucide-react';

const EXPORT_TIPS = [
    "If riding in a metro/suburban area, disable any drink/feed reminders that may pop up, as these may interfere with routing directions.",
];

interface ExportTipsDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onContinue: (dontShowAgain: boolean) => void;
}

export function ExportTipsDialog({ isOpen, onClose, onContinue }: ExportTipsDialogProps) {
    const [dontShowAgain, setDontShowAgain] = useState(false);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                    <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                        <Lightbulb className="w-5 h-5 text-amber-500" /> Before You Ride
                    </h2>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-6 space-y-3">
                    <ul className="space-y-3 text-sm text-gray-700">
                        {EXPORT_TIPS.map((tip, idx) => (
                            <li key={idx} className="flex gap-2">
                                <span className="text-amber-500 font-bold">&bull;</span>
                                <span>{tip}</span>
                            </li>
                        ))}
                    </ul>
                    <label className="flex items-center gap-2 text-sm text-gray-600 pt-2">
                        <input
                            type="checkbox"
                            checked={dontShowAgain}
                            onChange={(e) => setDontShowAgain(e.target.checked)}
                            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        Don&apos;t show this again
                    </label>
                </div>
                <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3 bg-gray-50/50">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                        Cancel
                    </button>
                    <button
                        onClick={() => onContinue(dontShowAgain)}
                        className="flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 transition-colors"
                    >
                        <Check className="w-4 h-4" /> Continue
                    </button>
                </div>
            </div>
        </div>
    );
}
