export type ListKeyAction =
    | { type: 'move'; index: number }
    | { type: 'select'; index: number }
    | { type: 'close' }
    | null;

// activeIndex of -1 means nothing is highlighted; arrows wrap around the list.
export function listKeyAction(key: string, activeIndex: number, count: number): ListKeyAction {
    if (count === 0) return null;
    switch (key) {
        case 'ArrowDown':
            return { type: 'move', index: activeIndex >= count - 1 ? 0 : activeIndex + 1 };
        case 'ArrowUp':
            return { type: 'move', index: activeIndex <= 0 ? count - 1 : activeIndex - 1 };
        case 'Enter':
            return { type: 'select', index: activeIndex >= 0 ? activeIndex : 0 };
        case 'Escape':
            return { type: 'close' };
        default:
            return null;
    }
}
