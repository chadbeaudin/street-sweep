'use client';

import { useState } from 'react';
import { X, MousePointerClick, BoxSelect, Home, ChevronLeft, ChevronRight } from 'lucide-react';

interface HowToDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

const slides = [
    {
        icon: MousePointerClick,
        title: 'Welcome to StreetSweep',
        body: (
            <>
                <p>StreetSweep finds roads you haven&apos;t ridden and builds efficient routes to cover them — it solves the <span className="font-medium">Chinese Postman Problem</span> for the area you choose.</p>
                <p className="text-gray-500">There are two ways to plan a route. Here&apos;s how each works.</p>
            </>
        ),
    },
    {
        icon: MousePointerClick,
        title: 'Point Mode',
        body: (
            <>
                <p>Click on roads or trails to drop <span className="font-medium">waypoints</span>. The route snaps to the nearest street and connects them in the order you click.</p>
                <div className="flex flex-col gap-1.5 text-sm">
                    <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-green-500 border border-white shadow" /> Start point</span>
                    <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-blue-500 border border-white shadow" /> Waypoint</span>
                    <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-500 border border-white shadow" /> End point</span>
                </div>
                <p className="text-gray-500">Drag a waypoint to move it, or drag the route line to insert a new one. Best for planning a specific path.</p>
            </>
        ),
    },
    {
        icon: BoxSelect,
        title: 'Area & Lasso Mode',
        body: (
            <>
                <p>Switch to <span className="font-medium">Area</span> mode (or press <kbd className="px-1 py-0.5 rounded bg-gray-100 border text-xs">A</kbd>) and drag a box — or use the <span className="font-medium">lasso</span> (or press <kbd className="px-1 py-0.5 rounded bg-gray-100 border text-xs">L</kbd>) to draw a freehand shape.</p>
                <p>StreetSweep sweeps <span className="font-medium">every unridden street</span> inside with minimal backtracking. Best for covering a whole neighborhood.</p>
                <p className="text-gray-500">Press <kbd className="px-1 py-0.5 rounded bg-gray-100 border text-xs">P</kbd> to return to Point mode.</p>
            </>
        ),
    },
    {
        icon: Home,
        title: 'Tips',
        body: (
            <>
                <ul className="list-disc pl-5 space-y-2 marker:text-indigo-400">
                    <li>Set a <span className="font-medium">Start Address</span> in Routing Preferences (the gear) so routes begin from home.</li>
                    <li>Connect <span className="font-medium">Strava</span> to overlay roads you&apos;ve already ridden — those are skipped.</li>
                    <li>Export the finished route as GPX/TCX/FIT or push it to Garmin.</li>
                </ul>
                <div className="text-xs text-gray-500 pt-1 border-t border-gray-100">
                    <div className="flex items-center gap-2"><span className="w-4 h-1 rounded bg-blue-600" /> roads you&apos;ve ridden &nbsp; <span className="w-4 h-1 rounded bg-indigo-500" /> generated route</div>
                </div>
            </>
        ),
    },
];

export function HowToDialog({ isOpen, onClose }: HowToDialogProps) {
    const [i, setI] = useState(0);
    if (!isOpen) return null;
    const slide = slides[i];
    const Icon = slide.icon;
    const last = i === slides.length - 1;

    return (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                    <div className="flex items-center gap-2 text-indigo-600">
                        <Icon className="w-5 h-5" />
                        <h2 className="text-base font-semibold text-gray-900">{slide.title}</h2>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
                </div>

                <div className="px-5 py-4 space-y-3 text-sm text-gray-700 min-h-[9rem]">
                    {slide.body}
                </div>

                <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
                    <button
                        onClick={() => setI(n => Math.max(0, n - 1))}
                        disabled={i === 0}
                        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 disabled:opacity-0"
                    >
                        <ChevronLeft className="w-4 h-4" /> Back
                    </button>
                    <div className="flex items-center gap-1.5">
                        {slides.map((_, k) => (
                            <span key={k} className={`w-1.5 h-1.5 rounded-full ${k === i ? 'bg-indigo-600' : 'bg-gray-300'}`} />
                        ))}
                    </div>
                    {last ? (
                        <button onClick={onClose} className="px-4 py-1.5 rounded-full bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">Got it</button>
                    ) : (
                        <button onClick={() => setI(n => Math.min(slides.length - 1, n + 1))} className="flex items-center gap-1 px-4 py-1.5 rounded-full bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">
                            Next <ChevronRight className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
