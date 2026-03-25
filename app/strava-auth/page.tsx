'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

function StravaAuthCallback() {
    const searchParams = useSearchParams();
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const router = useRouter();
    const [status, setStatus] = useState('Connecting to Strava...');

    useEffect(() => {
        if (error) {
            setStatus(`Authorization failed: ${error}. You may have denied the request.`);
            return;
        }

        if (!code) {
            setStatus('No authorization code found in URL.');
            return;
        }

        try {
            const savedSettings = localStorage.getItem('strava_settings');
            if (!savedSettings) {
                setStatus('Missing Strava credentials in local storage. Please return to Settings.');
                return;
            }

            const settings = JSON.parse(savedSettings);
            if (!settings.clientId || !settings.clientSecret) {
                setStatus('Missing Client ID or Secret in local storage. Please return to Settings.');
                return;
            }

            setStatus('Exchanging authorization code securely...');

            fetch('/api/strava/exchange', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    clientId: settings.clientId, 
                    clientSecret: settings.clientSecret, 
                    code 
                })
            })
            .then(res => res.json())
            .then(data => {
                if (data.refresh_token) {
                    settings.refreshToken = data.refresh_token;
                    localStorage.setItem('strava_settings', JSON.stringify(settings));
                    setStatus('Successfully connected to Strava! Redirecting to map...');
                    setTimeout(() => router.push('/'), 1500);
                } else {
                    setStatus('Failed to get token: ' + (data.error || JSON.stringify(data)));
                }
            })
            .catch(err => {
                setStatus('Network error during token exchange: ' + err.message);
            });
        } catch (err: any) {
            setStatus('Error processing request: ' + err.message);
        }
    }, [code, error, router]);

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 text-gray-900 font-sans p-4">
            <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md text-center border border-gray-100">
                <div className="w-16 h-16 bg-[#FC4C02] rounded-2xl flex items-center justify-center shadow-lg shadow-orange-200 mx-auto mb-6">
                    <svg className="w-8 h-8 text-white fill-current" viewBox="0 0 24 24">
                        <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
                    </svg>
                </div>
                <h1 className="text-2xl font-bold tracking-tight mb-2">Strava Connection</h1>
                <p className="text-gray-500 font-medium">
                    {status}
                </p>
            </div>
        </div>
    );
}

export default function StravaAuthPage() {
    return (
        <Suspense fallback={
            <div className="flex items-center justify-center min-h-screen bg-gray-50 text-gray-500 font-medium">
                Loading Strava auth module...
            </div>
        }>
            <StravaAuthCallback />
        </Suspense>
    );
}
