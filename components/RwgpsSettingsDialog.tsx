'use client';

import { X, Check, Save } from 'lucide-react';

interface RwgpsSettingsDialogProps {
    isOpen: boolean;
    onClose: () => void;
    isConnected: boolean;
}

export function RwgpsSettingsDialog({ isOpen, onClose, isConnected }: RwgpsSettingsDialogProps) {
    const handleConnect = () => {
        window.location.href = '/api/rwgps/auth';
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-white border border-gray-200 rounded-lg flex items-center justify-center shadow-sm">
                            <svg className="w-5 h-5 fill-current text-[#FC4C02]" viewBox="0 0 58 49" xmlns="http://www.w3.org/2000/svg">
                                <path clipRule="evenodd" fillRule="evenodd" d="M41.6918 28.4841c-.5525.5838-1.1779 1.2926-1.9076 2.1839-1.4333 1.7617-3.8205 4.5919-5.2538 6.291-.5212.6203-.9174 1.0894-1.0946 1.3031-7.0051 8.428-11.0653 10.0698-15.5269 10.3877-.7871.0782-1.6575.1199-2.6217.1199C7.54716 48.7697 0 42.2598 0 34.0559c0-7.6097 5.4154-13.8956 12.6968-14.7191h.0208c.5785-.0677 1.6835-.1928 3.0387 0 1.1935.172 3.0647.7245 3.3566 1.6106-1.8868-.3909-2.8875-.318-3.9091-.1981-2.6686.3127-4.545 1.105-5.89493 2.0953-3.01783 2.2047-5.06098 5.5561-5.06098 9.6007 0 6.4683 5.36849 11.7013 11.77941 11.7013 3.2419 0 6.2598-1.2718 8.4489-3.3619.4482-.37.8287-.7192 1.1258-1.0372 2.8719-3.0908 8.3967-9.6685 8.3967-11.107 0-1.6054-3.5859-5.2695-7.297-7.4951-5.2798-3.1637-5.4935-5.5926-5.4935-7.4481 0-5.95226 9.1733-9.05348 17.961-8.2039 2.1474 7.886 8.3602 8.329 9.4704 8.4072h.0104c3.2472.2345 4.8421-.0261 6.7758-.49s2.5487-.9017 2.5487-.9017 0 .6672-1.4906 1.6575c-1.4907.9903-5.6291 2.5018-8.4385 2.5018-5.9679 0-9.2098-2.5435-12.1964-5.8897-6.7653.5421-7.4064 2.5383-6.979 3.1742.9851 1.4698 11.4458 8.6417 12.3684 8.4853.2762-.0469.7505-.3023 1.402-.6567 2.111-1.1414 6.1139-3.3045 11.6022-2.8302 8.0684.2189 14.6357 6.7341 14.6357 14.8181s-6.4526 14.8859-15.0526 14.8859c-7.1146 0-11.8472-5.061-11.0289-6.2807.0104-.0156.0209-.026.0261-.0417 2.1734 2.0328 5.7281 4.1802 9.314 4.1802 6.8592 0 12.4153-5.3008 12.4153-11.842 0-6.5412-4.4824-10.8673-11.3051-11.4823-2.95-.2658-4.6544.3023-6.4734 1.2196-1.5637.7818-3.5651 2.5175-5.1079 4.102 0-.0105 0-.0157.0052-.0261h.0208Z" />
                                <path clipRule="evenodd" fillRule="evenodd" d="M48.0092 10.0803c2.1683-.0782 4.6075-1.9754 4.5033-4.83686-.099-2.86146-2.9814-4.602308-5.6135-5.019279C41.6556-.60978 36.3601.948647 34.9268 3.49217c0 0 .5629-.21891 1.3395-.42219 2.0223-.53163 4.0446-.27624 5.7073.69322.7401.43261.8652 1.39164.8652 1.5063 0 3.41395 3.0022 4.889 5.1704 4.8108Z" />
                            </svg>
                        </div>
                        <h2 className="text-xl font-bold text-gray-900">RideWithGPS Integration</h2>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    <p className="text-sm text-gray-600 leading-relaxed">
                        Connect your RideWithGPS account to upload generated routes directly to your library.
                        You&apos;ll be redirected to RideWithGPS to sign in and authorize StreetSweep — your
                        password is never shared with this app.
                    </p>
                    <p className="text-xs text-gray-400">
                        Note: routes land in your default library. RideWithGPS&apos;s API doesn&apos;t support
                        placing them into a specific folder — you can move them there manually afterward.
                    </p>
                </div>

                <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
                    <div className="text-sm">
                        {isConnected ? (
                            <span className="text-green-600 font-medium flex items-center gap-1">
                                <Check className="w-4 h-4" /> Connected to RideWithGPS
                            </span>
                        ) : (
                            <span className="text-amber-600 font-medium">Not connected</span>
                        )}
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleConnect}
                            className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors shadow-md shadow-blue-100"
                        >
                            <Save className="w-4 h-4" />
                            {isConnected ? 'Reconnect to RideWithGPS' : 'Connect to RideWithGPS'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
