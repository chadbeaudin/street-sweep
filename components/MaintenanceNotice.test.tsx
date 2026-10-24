/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MaintenanceNotice } from './MaintenanceNotice';

function serve(services: Record<string, boolean>) {
    global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ services }) });
}

describe('MaintenanceNotice (#129)', () => {
    it('renders nothing while every service is up', async () => {
        serve({ database: true, overpass: true, elevation: true });
        const { container } = render(<MaintenanceNotice />);
        await act(async () => {});
        expect(global.fetch).toHaveBeenCalledWith('/api/health', { cache: 'no-store' });
        expect(container).toBeEmptyDOMElement();
    });

    it('blocks the app with a maintenance screen when the database is down', async () => {
        serve({ database: false, overpass: true, elevation: true });
        render(<MaintenanceNotice />);
        expect(await screen.findByRole('alertdialog', { name: 'Down for maintenance' })).toBeInTheDocument();
    });

    it('shows a dismissible banner when only map or elevation data is degraded', async () => {
        serve({ database: true, overpass: false, elevation: true });
        render(<MaintenanceNotice />);
        const banner = await screen.findByRole('status');
        expect(banner).toHaveTextContent('Loading roads and generating routes may be slower');
        expect(banner).not.toHaveTextContent('Elevation');
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
});
