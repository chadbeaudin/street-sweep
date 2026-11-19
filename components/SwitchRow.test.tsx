/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { SwitchRow } from './SwitchRow';

describe('SwitchRow (#249)', () => {
    it('exposes its on/off state as a switch', () => {
        render(<SwitchRow label="Avoid Gravel" checked={false} onChange={() => {}} />);
        expect(screen.getByRole('switch', { name: 'Avoid Gravel' })).toHaveAttribute('aria-checked', 'false');
    });

    it('reports the flipped value when clicked', () => {
        const onChange = jest.fn();
        render(<SwitchRow label="Avoid Trails" checked={true} onChange={onChange} />);
        fireEvent.click(screen.getByRole('switch', { name: 'Avoid Trails' }));
        expect(onChange).toHaveBeenCalledWith(false);
    });
});
