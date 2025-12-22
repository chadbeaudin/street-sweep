'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';

const Map = dynamic(() => import('@/components/Map'), {
    ssr: false,
    loading: () => <div className="h-full w-full bg-gray-100 flex items-center justify-center">Loading Map...</div>
});

export default function Home() {
    const [bbox, setBbox] = useState<{ north: number, south: number, east: number, west: number } | null>(null);
    const [route, setRoute] = useState<[number, number][]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleGenerate = async () => {
        if (!bbox) {
            setError("Please move the map to set an area.");
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bbox })
            });

            if (!res.ok) {
                throw new Error(`Error: ${res.statusText}`);
            }

            const geoJson = await res.json();
            // Extract coordinates from the first feature
            if (geoJson.features && geoJson.features.length > 0) {
                setRoute(geoJson.features[0].geometry.coordinates);
            } else {
                setError("No route generated.");
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const downloadGPX = () => {
        if (route.length === 0) return;

        const gpxData = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="StreetSweep" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>StreetSweep Route</name>
    <trkseg>
${route.map(p => `      <trkpt lat="${p[1]}" lon="${p[0]}"></trkpt>`).join('\n')}
    </trkseg>
  </trk>
</gpx>`;

        const blob = new Blob([gpxData], { type: 'application/gpx+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'street-sweep-route.gpx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <main className="flex h-screen flex-col">
            <header className="bg-slate-900 text-white p-4 flex justify-between items-center shadow-md z-10">
                <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                    StreetSweep
                </h1>
                <div className="flex gap-4 items-center">
                    {route.length > 0 && (
                        <button
                            onClick={downloadGPX}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-md font-medium transition-colors shadow-sm flex items-center gap-2"
                        >
                            Download GPX
                        </button>
                    )}
                    {loading ? (
                        <div className="flex items-center text-sm gap-2 text-blue-300">
                            <Loader2 className="animate-spin h-4 w-4" /> Generating...
                        </div>
                    ) : (
                        <button
                            onClick={handleGenerate}
                            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-md font-medium transition-colors shadow-sm"
                        >
                            Generate Route
                        </button>
                    )}
                </div>
            </header>

            <div className="flex-1 relative">
                <Map
                    route={route}
                    bbox={bbox || undefined}
                    onBBoxChange={setBbox}
                />
                {error && (
                    <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-red-500/90 text-white px-4 py-2 rounded shadow-lg backdrop-blur-sm z-[1000]">
                        {error}
                    </div>
                )}
                {!bbox && !loading && (
                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white/80 p-6 rounded-xl shadow-xl backdrop-blur-md z-[1000] text-center max-w-sm">
                        <h2 className="text-lg font-semibold text-slate-800 mb-2">Ready to Sweep?</h2>
                        <p className="text-slate-600">Move the map to your target neighborhood and click <strong>Generate Route</strong>.</p>
                    </div>
                )}
            </div>
        </main>
    );
}
