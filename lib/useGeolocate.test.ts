import { useGeolocateOnMount } from './useGeolocate';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

// 1. Mock React
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useEffect: jest.fn()
}));

// 2. Mock React-Leaflet
jest.mock('react-leaflet', () => ({
  useMap: jest.fn()
}));

describe('useGeolocateOnMount', () => {
    let mockLocate: jest.Mock;
    let mockSetView: jest.Mock;
    let mockOn: jest.Mock;
    let mockOff: jest.Mock;
    let errorHandler: (() => void) | undefined;

    beforeEach(() => {
        jest.clearAllMocks();

        mockLocate = jest.fn();
        mockSetView = jest.fn();
        mockOn = jest.fn((event: string, cb: () => void) => {
            if (event === 'locationerror') errorHandler = cb;
        });
        mockOff = jest.fn();

        (useMap as jest.Mock).mockReturnValue({
            locate: mockLocate,
            setView: mockSetView,
            on: mockOn,
            off: mockOff,
        });
        (useEffect as jest.Mock).mockImplementation((cb) => cb());
    });

    it('should call map.locate with correct parameters to geolocate the user', () => {
        useGeolocateOnMount();

        expect(mockLocate).toHaveBeenCalledTimes(1);
        expect(mockLocate).toHaveBeenCalledWith({ setView: true, maxZoom: 14 });
    });

    it('always attempts geolocation even when a fallback is provided (geolocation takes priority)', () => {
        useGeolocateOnMount({ lat: 39.02, lon: -104.7 });

        expect(mockLocate).toHaveBeenCalledTimes(1);
        expect(mockSetView).not.toHaveBeenCalled();
    });

    it('falls back to the saved start point only if geolocation errors', () => {
        useGeolocateOnMount({ lat: 47.65, lon: -117.42 });

        expect(errorHandler).toBeDefined();
        errorHandler!();

        expect(mockSetView).toHaveBeenCalledWith([47.65, -117.42], 14);
    });

    it('does nothing on geolocation error when no fallback is provided', () => {
        useGeolocateOnMount();

        errorHandler!();

        expect(mockSetView).not.toHaveBeenCalled();
    });
});
