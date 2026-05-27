interface StravaHeaderButtonProps {
    isConnected: boolean;
    stravaError: string | null;
    isLoading?: boolean;
    onClick: () => void;
    onRefresh?: () => void;
}

export function StravaHeaderButton({ isConnected, stravaError, isLoading, onClick, onRefresh }: StravaHeaderButtonProps) {
    const isOrange = isConnected && !stravaError;

    return (
        <div className="flex items-center gap-1 mr-2 border-r border-gray-100 pr-3" data-testid="strava-header-container">
            <button
                data-testid="strava-header-button"
                onClick={onClick}
                className={`flex items-center justify-center w-9 h-9 rounded-md transition-all border shadow-sm ${isOrange
                    ? 'bg-[#FC4C02] border-[#e34402] hover:bg-[#e34402]'
                    : 'bg-white border-gray-300 hover:bg-gray-50'
                    }`}
                title={stravaError ? `Strava Error: ${stravaError}` : "Strava Settings"}
            >
                <svg className={`w-5 h-5 fill-current ${isOrange ? 'text-white' : 'text-gray-400'}`} viewBox="0 0 24 24">
                    <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
                </svg>
            </button>
            {isConnected && !stravaError && onRefresh && (
                <button
                    data-testid="strava-refresh-button"
                    onClick={onRefresh}
                    disabled={isLoading}
                    className="flex items-center justify-center w-7 h-7 rounded-md transition-all border border-gray-200 bg-white hover:bg-gray-50 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Sync Strava activities"
                >
                    <svg
                        className={`w-3.5 h-3.5 text-gray-500 ${isLoading ? 'animate-spin' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                </button>
            )}
        </div>
    );
}
