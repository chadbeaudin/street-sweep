// Never derived from Host/X-Forwarded-* headers: a spoofed header would let an
// attacker point an OAuth redirect_uri at their own host (#17, #195).
export function configuredBaseUrl(): string {
    const url = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_BASE_URL;
    if (!url) throw new Error('NEXTAUTH_URL or NEXT_PUBLIC_BASE_URL must be set');
    return url.replace(/\/$/, '');
}
