'use client';

import { useState } from 'react';
import { X, MousePointerClick, BoxSelect, Home, Info, ChevronLeft, ChevronRight } from 'lucide-react';
import pkg from '@/package.json';

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
                <p>StreetSweep helps you build an optimized route covering roads you haven&apos;t ridden yet.</p>
                <p>Unlike typical route planners that focus on the fastest or bike-friendliest path between two points, StreetSweep optimizes for <span className="font-medium">coverage</span> — getting you the most new road with the least backtracking.</p>
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
                    <li>Connect <span className="font-medium">Strava</span> to overlay roads you&apos;ve already ridden — those are skipped.</li>
                    <li>Send it directly to Garmin*, or export as GPX/TCX/FIT.</li>
                </ul>
                <div className="text-xs text-gray-500 pt-1 border-t border-gray-100">
                    <div className="flex items-center gap-2"><span className="w-4 h-1 rounded bg-blue-700" /> roads you&apos;ve ridden &nbsp; <span className="w-4 h-1 rounded bg-red-500" /> generated route</div>
                    <div className="pt-4">*Garmin push is experimental.</div>
                </div>
            </>
        ),
    },
    {
        icon: Info,
        title: 'About StreetSweep',
        body: (
            <>
                <p>
                    <strong>Street Sweep</strong> helps cyclists, runners, and hikers explore new areas they have not previously traveled.
                    Connect your Strava account to import all your activities which will be displayed on a single map.
                    StreetSweep will then help you generate optimized routes, previously untraveled by you, with minimal backtracking.
                </p>
                <div className="flex items-center justify-between pt-3 mt-3 border-t border-gray-100 text-xs text-gray-500">
                    <span className="font-medium">Version {pkg.version}</span>
                    <a
                        href="https://github.com/chadbeaudin/street-sweep"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 hover:text-indigo-600 font-semibold transition-colors"
                    >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                        </svg>
                        GitHub Repository
                    </a>
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
