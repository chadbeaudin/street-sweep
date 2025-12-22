"use client";

import { X, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { useState } from "react";

interface ErrorDialogProps {
    message: string;
    trace?: string;
    onClose: () => void;
}

export function ErrorDialog({ message, trace, onClose }: ErrorDialogProps) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-2xl bg-white rounded-xl shadow-2xl overflow-hidden border border-red-200 animate-in zoom-in-95 duration-200">
                <div className="bg-red-50 p-4 border-b border-red-100 flex justify-between items-start">
                    <div className="flex gap-3">
                        <div className="bg-red-100 p-2 rounded-full">
                            <X className="w-6 h-6 text-red-600" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-red-900">Error Occurred</h3>
                            <p className="text-red-700 text-sm mt-1">{message}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-red-400 hover:text-red-600 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {trace && (
                    <div className="p-4 bg-white">
                        <button
                            onClick={() => setExpanded(!expanded)}
                            className="flex items-center text-sm text-slate-500 hover:text-slate-800 transition-colors mb-2 gap-1 font-medium"
                        >
                            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            {expanded ? "Hide Stack Trace" : "Show Stack Trace"}
                        </button>

                        {expanded && (
                            <div className="relative group">
                                <pre className="bg-slate-900 text-slate-50 p-4 rounded-lg text-xs overflow-x-auto font-mono leading-relaxed border border-slate-800 shadow-inner max-h-[400px]">
                                    {trace}
                                </pre>
                                <button
                                    onClick={() => navigator.clipboard.writeText(trace)}
                                    className="absolute top-2 right-2 p-1.5 bg-slate-800 text-slate-400 rounded hover:text-white hover:bg-slate-700 opacity-0 group-hover:opacity-100 transition-all"
                                    title="Copy trace"
                                >
                                    <Copy className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        )}
                    </div>
                )}

                <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-slate-700 text-sm font-medium hover:bg-slate-50 hover:text-slate-900 shadow-sm transition-all"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
