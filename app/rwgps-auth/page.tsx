'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

function RwgpsAuthCallback() {
    const searchParams = useSearchParams();
    const code = searchParams.get('code');
    const stateParam = searchParams.get('state');
    const error = searchParams.get('error');
    const router = useRouter();
    const [status, setStatus] = useState('Connecting to RideWithGPS...');

    useEffect(() => {
        if (error) {
            setStatus(`Authorization failed: ${error}. You may have denied the request.`);
            return;
        }

        if (!code) {
            setStatus('No authorization code found in URL.');
            return;
        }

        const stateCookie = document.cookie
            .split(';')
            .find(c => c.trim().startsWith('rwgps_oauth_state='))
            ?.split('=')[1];

        if (!stateParam || !stateCookie || stateParam !== stateCookie) {
            setStatus('Authorization failed: invalid state parameter. Please try connecting again.');
            return;
        }

        document.cookie = 'rwgps_oauth_state=; Max-Age=0; path=/';

        setStatus('Exchanging authorization code securely...');

        fetch('/api/rwgps/exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        })
            .then(res => res.json())
            .then(data => {
                if (data.access_token) {
                    localStorage.setItem('rwgps_settings', JSON.stringify({ accessToken: data.access_token }));
                    setStatus('Successfully connected to RideWithGPS! Redirecting to map...');
                    setTimeout(() => router.push('/'), 1500);
                } else {
                    const detail = data.details ? JSON.stringify(data.details) : '';
                    setStatus('Failed to get token: ' + (data.error || JSON.stringify(data)) + (detail ? ` — ${detail}` : ''));
                }
            })
            .catch(err => {
                setStatus('Network error during token exchange: ' + err.message);
            });
    }, [code, error, stateParam, router]);

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 text-gray-900 font-sans p-4">
            <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md text-center border border-gray-100">
                <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200 mx-auto mb-6">
                    <svg className="w-8 h-8 text-white fill-current" viewBox="0 0 24 24">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
                        <circle cx="12" cy="12" r="5" />
                    </svg>
                </div>
                <h1 className="text-2xl font-bold tracking-tight mb-2">RideWithGPS Connection</h1>
                <p className="text-gray-500 font-medium">
                    {status}
                </p>
            </div>
        </div>
    );
}

export default function RwgpsAuthPage() {
    return (
        <Suspense fallback={
            <div className="flex items-center justify-center min-h-screen bg-gray-50 text-gray-500 font-medium">
                Loading RideWithGPS auth module...
            </div>
        }>
            <RwgpsAuthCallback />
        </Suspense>
    );
}
