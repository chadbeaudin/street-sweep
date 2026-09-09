'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X, MousePointerClick, BoxSelect, Ban, Home, Info, ChevronLeft, ChevronRight } from 'lucide-react';
import pkg from '@/package.json';

interface HowToDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

const slides = [
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
                <p className="text-gray-500">
                    This is an open source project. Feel free to submit bugs, request features, or submit a pull request.
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
        targetId: 'mode-point',
        body: (
            <>
                <p>Click on roads or trails to drop <span className="font-medium">waypoints</span>. The route snaps to the nearest street and connects them in the order you click.</p>
                <div className="flex flex-col gap-1.5 text-sm">
                    <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-green-500 border border-white shadow" /> Start point</span>
                    <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-blue-500 border border-white shadow" /> Waypoint</span>
                    <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-500 border border-white shadow" /> End point</span>
                </div>
                <p className="text-gray-500">Drag a waypoint to move it, right-click for delete, or drag the route line to insert a new one. Best for planning a specific path.</p>
            </>
        ),
    },
    {
        icon: BoxSelect,
        title: 'Area & Lasso Mode',
        targetId: 'mode-area-lasso',
        body: (
            <>
                <p>Switch to <span className="font-medium">Area</span> mode (or press <kbd className="px-1 py-0.5 rounded bg-gray-100 border text-xs">A</kbd>) and drag a box — or use the <span className="font-medium">lasso</span> (or press <kbd className="px-1 py-0.5 rounded bg-gray-100 border text-xs">L</kbd>) to draw a freehand shape.</p>
                <p>StreetSweep sweeps <span className="font-medium">every unridden street</span> inside with minimal backtracking. Best for covering a whole neighborhood.</p>
                <p className="text-gray-500">Press <kbd className="px-1 py-0.5 rounded bg-gray-100 border text-xs">P</kbd> to return to Point mode.</p>
            </>
        ),
    },
    {
        icon: Ban,
        title: 'Avoid Roads',
        targetId: 'mode-avoid',
        body: (
            <>
                <p>Switch to <span className="font-medium">Avoid</span> mode and click points on the map — each click snaps a path along the street from the last one, drawing the segment you want to avoid.</p>
                <p>Click <span className="font-medium">Avoid</span> again to finish. The route generator will still use an avoided road as a last resort, but heavily prefers any alternative.</p>
                <p className="text-gray-500">Avoided roads are remembered on this browser and clear with the <Ban className="w-3.5 h-3.5 inline -mt-0.5" /> button next to the mode selector.</p>
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
                    <li>Sync your route library with <span className="font-medium">RideWithGPS</span>, or export a single route there.</li>
                    <li>Send it directly to Garmin*, or export as GPX/TCX/FIT.</li>
                </ul>
                <div className="text-xs text-gray-500 pt-1 border-t border-gray-100">
                    <div className="flex items-center gap-2"><span className="w-4 h-1 rounded bg-blue-700" /> roads you&apos;ve ridden &nbsp; <span className="w-4 h-1 rounded bg-red-500" /> generated route</div>
                    <div className="pt-4">*Garmin push is experimental.</div>
                </div>
            </>
        ),
    },
];

const SPOTLIGHT_PADDING = 8;
const CARD_WIDTH = 380;
const CARD_GAP = 14;
const VIEWPORT_MARGIN = 16;

export function HowToDialog({ isOpen, onClose }: HowToDialogProps) {
    const [i, setI] = useState(0);
    const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const [cardHeight, setCardHeight] = useState(220);

    const slide = slides[i];
    const Icon = slide.icon;
    const last = i === slides.length - 1;

    // Track the highlighted element's position for the current slide, and keep
    // it in sync with layout changes (window resize, mobile menu open/close)
    // while the tour is open -- the spotlighted button can move under the tour.
    useEffect(() => {
        if (!isOpen) return;
        const targetId = slide.targetId;
        if (!targetId) { setTargetRect(null); return; }

        const update = () => {
            const el = document.querySelector(`[data-tour="${targetId}"]`);
            setTargetRect(el ? el.getBoundingClientRect() : null);
        };
        update();
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
        };
    }, [isOpen, slide.targetId]);

    // Measure the card after each render so positioning next to the spotlight
    // (which may need to flip above/below/beside) accounts for real content height.
    useLayoutEffect(() => {
        if (cardRef.current) setCardHeight(cardRef.current.getBoundingClientRect().height);
    });

    if (!isOpen) return null;

    const hasSpotlight = !!(slide.targetId && targetRect);

    let cardStyle: React.CSSProperties = {};
    if (hasSpotlight && targetRect) {
        const spaceBelow = window.innerHeight - targetRect.bottom;
        const spaceAbove = targetRect.top;
        const placeBelow = spaceBelow >= cardHeight + CARD_GAP + VIEWPORT_MARGIN || spaceBelow >= spaceAbove;

        const top = placeBelow
            ? Math.min(targetRect.bottom + CARD_GAP, window.innerHeight - cardHeight - VIEWPORT_MARGIN)
            : Math.max(VIEWPORT_MARGIN, targetRect.top - cardHeight - CARD_GAP);

        const left = Math.min(
            Math.max(VIEWPORT_MARGIN, targetRect.right - CARD_WIDTH),
            window.innerWidth - CARD_WIDTH - VIEWPORT_MARGIN
        );

        cardStyle = { position: 'fixed', top, left, width: CARD_WIDTH };
    }

    return (
        <div className="fixed inset-0 z-[3000]" onClick={onClose}>
            {hasSpotlight && targetRect ? (
                <div
                    className="fixed rounded-lg ring-2 ring-indigo-400 transition-all duration-200"
                    style={{
                        top: targetRect.top - SPOTLIGHT_PADDING,
                        left: targetRect.left - SPOTLIGHT_PADDING,
                        width: targetRect.width + SPOTLIGHT_PADDING * 2,
                        height: targetRect.height + SPOTLIGHT_PADDING * 2,
                        boxShadow: '0 0 0 9999px rgba(15, 15, 20, 0.75)',
                        pointerEvents: 'none',
                    }}
                />
            ) : (
                <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            )}

            <div
                className={hasSpotlight ? '' : 'absolute inset-0 flex items-center justify-center p-4'}
                style={hasSpotlight ? cardStyle : undefined}
            >
                <div
                    ref={cardRef}
                    className={`bg-white rounded-2xl shadow-2xl overflow-hidden ${hasSpotlight ? 'w-full' : 'max-w-md w-full'}`}
                    onClick={e => e.stopPropagation()}
                >
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
        </div>
    );
}
