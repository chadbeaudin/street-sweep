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

    beforeEach(() => {
        jest.clearAllMocks();
        
        // Define the mock locate function
        mockLocate = jest.fn();
        
        // Wire up the hoisted module mocks to return our local mock instances
        (useMap as jest.Mock).mockReturnValue({ locate: mockLocate });
        (useEffect as jest.Mock).mockImplementation((cb) => cb());
    });

    it('should call map.locate with correct parameters to geolocate the user', () => {
        // Render/Call the hook directly
        useGeolocateOnMount();

        // Verify leaflet's map.locate was triggered with the correct options
        expect(mockLocate).toHaveBeenCalledTimes(1);
        expect(mockLocate).toHaveBeenCalledWith({ setView: true, maxZoom: 14 });
    });
});
