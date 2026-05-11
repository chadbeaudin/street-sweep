'use client';

import { useState, useEffect } from 'react';
import { X, Save, Check, User, Lock, AlertCircle } from 'lucide-react';

interface GarminSettings {
    email?: string;
    password?: string;
}

interface GarminSettingsDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (settings: GarminSettings) => void;
}

export function GarminSettingsDialog({ isOpen, onClose, onSave }: GarminSettingsDialogProps) {
    const [settings, setSettings] = useState<GarminSettings>({});
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        const savedSettings = localStorage.getItem('garmin_settings');
        if (savedSettings) {
            try {
                setSettings(JSON.parse(savedSettings));
            } catch (e) {
                console.error('Failed to parse saved Garmin settings');
            }
        }
    }, [isOpen]);

    const handleSave = () => {
        localStorage.setItem('garmin_settings', JSON.stringify(settings));
        onSave(settings);
        setSaved(true);
        setTimeout(() => {
            setSaved(false);
            onClose();
        }, 1000);
    };

    if (!isOpen) return null;

    const canSave = !!(settings.email && settings.password);

    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-sm">
                            <svg className="w-5 h-5 text-white fill-current" viewBox="0 0 24 24">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
                                <circle cx="12" cy="12" r="5" />
                            </svg>
                        </div>
                        <h2 className="text-xl font-bold text-gray-900">Garmin Connect</h2>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    <div className="bg-amber-50 border border-amber-100 rounded-lg p-4 flex gap-3">
                        <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                        <div className="text-sm text-amber-900">
                            <p className="font-semibold mb-1">Direct Upload Integration</p>
                            To send routes directly to your Garmin device, we need to authenticate with Garmin Connect. Your credentials are stored locally in your browser.
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                                <User className="w-4 h-4" /> Garmin Email
                            </label>
                            <input
                                type="email"
                                value={settings.email ?? ''}
                                onChange={(e) => setSettings({ ...settings, email: e.target.value })}
                                placeholder="your@email.com"
                                className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all outline-none text-gray-900"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                                <Lock className="w-4 h-4" /> Garmin Password
                            </label>
                            <input
                                type="password"
                                value={settings.password ?? ''}
                                onChange={(e) => setSettings({ ...settings, password: e.target.value })}
                                placeholder="••••••••"
                                className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all outline-none text-gray-900"
                            />
                        </div>
                    </div>
                </div>

                <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end bg-gray-50/50 gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!canSave}
                        className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors shadow-md shadow-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {saved ? (
                            <>
                                <Check className="w-4 h-4" />
                                Saved
                            </>
                        ) : (
                            <>
                                <Save className="w-4 h-4" />
                                Save Credentials
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
