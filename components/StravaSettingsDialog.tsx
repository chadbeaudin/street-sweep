'use client';

import { useState, useEffect } from 'react';
import { X, ExternalLink, HelpCircle, Save, Check } from 'lucide-react';

interface StravaSettings {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
}

interface StravaSettingsDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (settings: StravaSettings) => void;
}

export function StravaSettingsDialog({ isOpen, onClose, onSave }: StravaSettingsDialogProps) {
    const [settings, setSettings] = useState<StravaSettings>({
        clientId: '',
        clientSecret: '',
        refreshToken: ''
    });
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        const savedSettings = localStorage.getItem('strava_settings');
        if (savedSettings) {
            try {
                setSettings(JSON.parse(savedSettings));
            } catch (e) {
                console.error('Failed to parse saved Strava settings');
            }
        }
    }, [isOpen]);

    const handleSave = () => {
        localStorage.setItem('strava_settings', JSON.stringify(settings));
        onSave(settings);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-[#FC4C02] rounded-lg flex items-center justify-center shadow-sm">
                            <svg className="w-5 h-5 text-white fill-current" viewBox="0 0 24 24">
                                <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
                            </svg>
                        </div>
                        <h2 className="text-xl font-bold text-gray-900">Strava Integration</h2>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-8">
                    {/* Instructions */}
                    <section className="space-y-4">
                        <div className="flex items-center gap-2 text-indigo-600 font-semibold uppercase tracking-wider text-xs">
                            <HelpCircle className="w-4 h-4" />
                            How to connect to Strava
                        </div>
                        <div className="bg-indigo-50 rounded-lg p-5 border border-indigo-100 space-y-3">
                            <ol className="list-decimal list-inside space-y-3 text-sm text-indigo-900 leading-relaxed">
                                <li>
                                    Go to the <a href="https://www.strava.com/settings/api" target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-bold underline hover:text-indigo-700">Strava API Settings <ExternalLink className="w-3 h-3" /></a>
                                </li>
                                <li> Create an application (if you haven&apos;t yet). Use &quot;StreetSweep&quot; as the name and &quot;localhost&quot; as the Authorization Callback Domain.</li>
                                <li> Copy your <strong>Client ID</strong> and <strong>Client Secret</strong> into the fields below.</li>
                                <li className="text-amber-800 font-semibold bg-amber-50 p-2 rounded border border-amber-100">
                                    <Check className="w-3 h-3 inline mr-1" />
                                    IMPORTANT: When you click Connect to Strava below, you will be taken to an authorization page. You MUST manually check all the boxes (especially &quot;View data about your activities&quot; and &quot;View data about your private activities&quot;) or the app will not fetch routes.
                                </li>
                                <li> Click the Connect button below to securely authenticate. </li>
                            </ol>
                        </div>
                    </section>

                    {/* Form */}
                    <div className="grid gap-6">
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-gray-700">Client ID</label>
                            <input
                                type="text"
                                value={settings.clientId}
                                onChange={(e) => setSettings({ ...settings, clientId: e.target.value })}
                                placeholder="12345"
                                className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#FC4C02] focus:border-transparent transition-all outline-none text-gray-900"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-gray-700">Client Secret</label>
                            <input
                                type="password"
                                value={settings.clientSecret}
                                onChange={(e) => setSettings({ ...settings, clientSecret: e.target.value })}
                                placeholder="••••••••••••••••••••••••••••••••"
                                className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#FC4C02] focus:border-transparent transition-all outline-none text-gray-900"
                            />
                        </div>
                    </div>
                </div>

                <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
                    <div className="text-sm">
                        {settings.refreshToken ? (
                            <span className="text-green-600 font-medium flex items-center gap-1">
                                <Check className="w-4 h-4" /> Connected to Strava
                            </span>
                        ) : (
                            <span className="text-amber-600 font-medium">Not connected</span>
                        )}
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => {
                                localStorage.setItem('strava_settings', JSON.stringify(settings));
                                window.location.href = `https://www.strava.com/oauth/authorize?client_id=${settings.clientId}&response_type=code&redirect_uri=${window.location.origin}/strava-auth&approval_prompt=force&scope=read,activity:read_all`;
                            }}
                            disabled={!settings.clientId || !settings.clientSecret}
                            className="flex items-center gap-2 px-6 py-2 bg-[#FC4C02] text-white rounded-lg text-sm font-bold hover:bg-[#e34402] transition-colors shadow-md shadow-orange-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Save className="w-4 h-4" />
                            Connect to Strava
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
