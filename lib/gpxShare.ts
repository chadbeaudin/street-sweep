export function buildGpxFile(gpx: string, filename: string): File {
    return new File([gpx], filename, { type: 'application/gpx+xml' });
}

function download(gpx: string, filename: string): void {
    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export async function shareOrDownloadGpx(gpx: string, filename: string): Promise<void> {
    const file = buildGpxFile(gpx, filename);
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare?.({ files: [file] })) {
        try {
            await nav.share({ files: [file], title: filename });
            return;
        } catch (err) {
            // User cancelled or share failed — fall through to download.
            if ((err as DOMException)?.name === 'AbortError') return;
        }
    }
    download(gpx, filename);
}
