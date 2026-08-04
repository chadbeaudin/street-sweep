import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'StreetSweep',
        short_name: 'StreetSweep',
        description: 'Find and route the streets you haven\'t ridden yet.',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#FC4C02',
        icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
    };
}
