/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { StravaHeaderButton } from './StravaHeaderButton';

describe('StravaHeaderButton', () => {
    it('should render as gray when not connected', () => {
        render(<StravaHeaderButton isConnected={false} stravaError={null} onClick={jest.fn()} />);
        const button = screen.getByTestId('strava-header-button');
        
        // Assert absence of orange background
        expect(button).not.toHaveClass('bg-[#FC4C02]');
        // Assert presence of default/gray background
        expect(button).toHaveClass('bg-white');
    });

    it('should render as orange when connected successfully', () => {
        render(<StravaHeaderButton isConnected={true} stravaError={null} onClick={jest.fn()} />);
        const button = screen.getByTestId('strava-header-button');
        
        // Assert presence of orange background
        expect(button).toHaveClass('bg-[#FC4C02]');
    });

    it('should render as gray when connected but there is an error', () => {
        render(<StravaHeaderButton isConnected={true} stravaError="Token expired or missing" onClick={jest.fn()} />);
        const button = screen.getByTestId('strava-header-button');
        
        // Assert it falls back to gray if an error exists
        expect(button).not.toHaveClass('bg-[#FC4C02]');
        expect(button).toHaveClass('bg-white');
    });
});
