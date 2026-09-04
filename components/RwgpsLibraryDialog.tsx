'use client';

import { useEffect, useState } from 'react';
import { X, ChevronRight, ChevronDown, Route as RouteIcon, Folder, Loader2 } from 'lucide-react';

interface RwgpsRouteSummary {
    id: number;
    name: string;
    distance: number; // meters
    url: string;
}

interface RwgpsLibraryTree {
    collections: { id: number; name: string | null; routes: RwgpsRouteSummary[] }[];
    uncategorized: RwgpsRouteSummary[];
}

interface RwgpsLibraryDialogProps {
    isOpen: boolean;
    onClose: () => void;
    accessToken: string;
    isLoadingRoute: boolean;
    onSelectRoute: (routeId: number, routeName: string) => void;
}

const metersToMiles = (m: number) => (m / 1609.344).toFixed(1);

function RouteRow({ route, isLoadingRoute, onSelectRoute }: { route: RwgpsRouteSummary; isLoadingRoute: boolean; onSelectRoute: (id: number, name: string) => void }) {
    return (
        <button
            onClick={() => onSelectRoute(route.id, route.name)}
            disabled={isLoadingRoute}
            className="w-full flex items-center gap-2 py-1.5 px-2 pl-8 text-sm text-left text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 rounded-md transition-colors disabled:opacity-50"
        >
            <RouteIcon className="w-3.5 h-3.5 shrink-0 text-gray-400" />
            <span className="flex-1 truncate">{route.name}</span>
            <span className="text-xs text-gray-400 shrink-0">{metersToMiles(route.distance)} mi</span>
        </button>
    );
}

function CollectionNode({ collection, isLoadingRoute, onSelectRoute }: { collection: RwgpsLibraryTree['collections'][number]; isLoadingRoute: boolean; onSelectRoute: (id: number, name: string) => void }) {
    const [expanded, setExpanded] = useState(false);
    return (
        <div>
            <button
                onClick={() => setExpanded(e => !e)}
                className="w-full flex items-center gap-2 py-1.5 px-2 text-sm font-medium text-left text-gray-800 hover:bg-gray-100 rounded-md transition-colors"
            >
                {expanded ? <ChevronDown className="w-4 h-4 shrink-0 text-gray-400" /> : <ChevronRight className="w-4 h-4 shrink-0 text-gray-400" />}
                <Folder className="w-4 h-4 shrink-0 text-amber-500" />
                <span className="flex-1 truncate">{collection.name || 'Untitled Collection'}</span>
                <span className="text-xs text-gray-400 shrink-0">{collection.routes.length}</span>
            </button>
            {expanded && (
                <div className="mt-0.5">
                    {collection.routes.length === 0 ? (
                        <p className="pl-8 py-1 text-xs text-gray-400">No routes in this collection</p>
                    ) : (
                        collection.routes.map(r => <RouteRow key={r.id} route={r} isLoadingRoute={isLoadingRoute} onSelectRoute={onSelectRoute} />)
                    )}
                </div>
            )}
        </div>
    );
}

export function RwgpsLibraryDialog({ isOpen, onClose, accessToken, isLoadingRoute, onSelectRoute }: RwgpsLibraryDialogProps) {
    const [tree, setTree] = useState<RwgpsLibraryTree | null>(null);
    const [isLoadingTree, setIsLoadingTree] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        setIsLoadingTree(true);
        setError(null);
        fetch('/api/rwgps/library', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken }),
        })
            .then(res => res.json())
            .then(data => {
                if (data.error) throw new Error(data.error);
                setTree(data);
            })
            .catch(err => setError(err.message || 'Failed to load your RideWithGPS library'))
            .finally(() => setIsLoadingTree(false));
    }, [isOpen, accessToken]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden max-h-[80vh]">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50 shrink-0">
                    <h2 className="text-lg font-bold text-gray-900">RideWithGPS Library</h2>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-3 overflow-y-auto flex-1">
                    {isLoadingTree && (
                        <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
                            <Loader2 className="w-4 h-4 animate-spin" /> Loading your library…
                        </div>
                    )}
                    {error && (
                        <p className="text-sm text-red-600 px-2 py-4">{error}</p>
                    )}
                    {tree && !isLoadingTree && (
                        <>
                            {tree.collections.map(c => (
                                <CollectionNode key={c.id} collection={c} isLoadingRoute={isLoadingRoute} onSelectRoute={onSelectRoute} />
                            ))}
                            {tree.uncategorized.length > 0 && (
                                <div className="mt-1">
                                    <div className="flex items-center gap-2 py-1.5 px-2 text-sm font-medium text-gray-800">
                                        <Folder className="w-4 h-4 shrink-0 text-gray-300" />
                                        <span className="flex-1">Uncategorized</span>
                                        <span className="text-xs text-gray-400">{tree.uncategorized.length}</span>
                                    </div>
                                    {tree.uncategorized.map(r => <RouteRow key={r.id} route={r} isLoadingRoute={isLoadingRoute} onSelectRoute={onSelectRoute} />)}
                                </div>
                            )}
                            {tree.collections.length === 0 && tree.uncategorized.length === 0 && (
                                <p className="text-sm text-gray-500 px-2 py-4">No routes found in your RideWithGPS library.</p>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
