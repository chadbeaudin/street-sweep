/**
 * @jest-environment jsdom
 */

import { render } from '@testing-library/react';
import ServiceWorkerRegister from './ServiceWorkerRegister';

const register = jest.fn();
const unregister = jest.fn();
const getRegistrations = jest.fn();
const originalEnv = process.env.NODE_ENV;

function setNodeEnv(value: string) {
    Object.defineProperty(process.env, 'NODE_ENV', { value, configurable: true, writable: true });
}

beforeEach(() => {
    register.mockResolvedValue(undefined);
    unregister.mockResolvedValue(true);
    getRegistrations.mockResolvedValue([{ unregister }, { unregister }]);
    Object.defineProperty(navigator, 'serviceWorker', {
        value: { register, getRegistrations },
        configurable: true,
    });
});

afterEach(() => setNodeEnv(originalEnv as string));

describe('ServiceWorkerRegister', () => {
    it('unregisters existing workers and never registers one in development', async () => {
        setNodeEnv('development');
        render(<ServiceWorkerRegister />);
        window.dispatchEvent(new Event('load'));
        await Promise.resolve();
        await Promise.resolve();

        expect(getRegistrations).toHaveBeenCalled();
        expect(unregister).toHaveBeenCalledTimes(2);
        expect(register).not.toHaveBeenCalled();
    });

    it('registers the worker on load in production', () => {
        setNodeEnv('production');
        render(<ServiceWorkerRegister />);
        window.dispatchEvent(new Event('load'));

        expect(register).toHaveBeenCalledWith('/sw.js');
        expect(getRegistrations).not.toHaveBeenCalled();
    });
});
