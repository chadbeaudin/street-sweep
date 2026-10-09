import { listKeyAction } from './listNavigation';

describe('listKeyAction', () => {
    it('ignores keys when the list is empty', () => {
        expect(listKeyAction('ArrowDown', -1, 0)).toBeNull();
        expect(listKeyAction('Enter', -1, 0)).toBeNull();
    });

    it('ArrowDown highlights the first item when nothing is highlighted', () => {
        expect(listKeyAction('ArrowDown', -1, 3)).toEqual({ type: 'move', index: 0 });
    });

    it('ArrowDown advances and wraps to the top', () => {
        expect(listKeyAction('ArrowDown', 0, 3)).toEqual({ type: 'move', index: 1 });
        expect(listKeyAction('ArrowDown', 2, 3)).toEqual({ type: 'move', index: 0 });
    });

    it('ArrowUp moves back and wraps to the bottom', () => {
        expect(listKeyAction('ArrowUp', 2, 3)).toEqual({ type: 'move', index: 1 });
        expect(listKeyAction('ArrowUp', 0, 3)).toEqual({ type: 'move', index: 2 });
        expect(listKeyAction('ArrowUp', -1, 3)).toEqual({ type: 'move', index: 2 });
    });

    it('Enter selects the highlighted item, or the first when none is highlighted', () => {
        expect(listKeyAction('Enter', 1, 3)).toEqual({ type: 'select', index: 1 });
        expect(listKeyAction('Enter', -1, 3)).toEqual({ type: 'select', index: 0 });
    });

    it('Escape closes the list', () => {
        expect(listKeyAction('Escape', 1, 3)).toEqual({ type: 'close' });
    });

    it('ignores unrelated keys', () => {
        expect(listKeyAction('a', 0, 3)).toBeNull();
    });
});
