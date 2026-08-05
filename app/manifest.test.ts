import manifest from './manifest';

test('manifest declares an installable standalone PWA', () => {
    const m = manifest();
    expect(m.name).toBe('StreetSweep');
    expect(m.short_name).toBe('StreetSweep');
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('/');
    // At least a 192 and a 512 icon, and one maskable icon
    const sizes = (m.icons ?? []).map(i => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect((m.icons ?? []).some(i => i.purpose === 'maskable')).toBe(true);
});
