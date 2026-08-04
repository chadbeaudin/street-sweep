'use client';

import { X, ExternalLink, Check } from 'lucide-react';

interface RwgpsSuccessDialogProps {
    routeUrl: string;
    onClose: () => void;
}

export function RwgpsSuccessDialog({ routeUrl, onClose }: RwgpsSuccessDialogProps) {
    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm bg-white rounded-xl shadow-2xl overflow-hidden border border-green-200">
                <div className="bg-green-50 p-4 border-b border-green-100 flex justify-between items-start">
                    <div className="flex gap-3">
                        <div className="bg-green-100 p-2 rounded-full">
                            <Check className="w-6 h-6 text-green-600" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-green-900">Uploaded to RideWithGPS</h3>
                            <p className="text-green-700 text-sm mt-1">Your route was added to your library.</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-green-400 hover:text-green-600 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-slate-700 text-sm font-medium hover:bg-slate-50 hover:text-slate-900 shadow-sm transition-all"
                    >
                        Close
                    </button>
                    <a
                        href={routeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-4 py-2 bg-[#FC4C02] text-white rounded-lg text-sm font-bold hover:bg-[#e34402] transition-colors shadow-sm"
                    >
                        View Route <ExternalLink className="w-4 h-4" />
                    </a>
                </div>
            </div>
        </div>
    );
}
