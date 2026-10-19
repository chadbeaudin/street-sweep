/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';

const mockUseSession = jest.fn();
const mockSignIn = jest.fn();
jest.mock('next-auth/react', () => ({
    useSession: () => mockUseSession(),
    signIn: (...args: unknown[]) => mockSignIn(...args),
    signOut: jest.fn(),
}));
jest.mock('./DeleteAccountDialog', () => ({ DeleteAccountDialog: () => null }));
jest.mock('./StravaCreditToggle', () => ({ StravaCreditToggle: () => <div>Credit toggle</div> }));

import { AccountButton } from './AccountButton';

describe('AccountButton (#126)', () => {
    it('offers a single Strava sign-in when signed out', () => {
        mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });
        render(<AccountButton />);
        fireEvent.click(screen.getByRole('button', { name: 'Sign in with Strava' }));
        expect(mockSignIn).toHaveBeenCalledWith('strava');
        expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    it('shows the account menu instead when signed in', () => {
        mockUseSession.mockReturnValue({ data: { user: { name: 'Rider' } }, status: 'authenticated' });
        render(<AccountButton />);
        expect(screen.queryByText('Sign in with Strava')).not.toBeInTheDocument();
        expect(screen.getByText('Rider')).toBeInTheDocument();
    });

    it('lists Admin in the account menu only for admins (#117)', () => {
        mockUseSession.mockReturnValue({ data: { user: { name: 'Rider', isAdmin: true } }, status: 'authenticated' });
        const { unmount } = render(<AccountButton />);
        fireEvent.click(screen.getByText('Rider'));
        expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
        unmount();

        mockUseSession.mockReturnValue({ data: { user: { name: 'Rider' } }, status: 'authenticated' });
        render(<AccountButton />);
        fireEvent.click(screen.getByText('Rider'));
        expect(screen.getByText('Sign out')).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
    });

    it('puts the Strava credit toggle at the bottom, under Delete account', () => {
        mockUseSession.mockReturnValue({ data: { user: { name: 'Rider', isAdmin: true } }, status: 'authenticated' });
        render(<AccountButton />);
        fireEvent.click(screen.getByText('Rider'));
        const items = Array.from(screen.getByText('Sign out').parentElement!.children).map(el => el.textContent);
        expect(items).toEqual(['Admin', 'Sign out', 'Delete account', 'Credit toggle']);
    });
});
