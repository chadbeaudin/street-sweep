interface StravaHeaderButtonProps {
    isConnected: boolean;
    stravaError: string | null;
    onClick: () => void;
}

export function StravaHeaderButton({ isConnected, stravaError, onClick }: StravaHeaderButtonProps) {
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
        </div>
    );
}
