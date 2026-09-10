import type { NextAuthOptions } from 'next-auth';
import StravaProviderBase from 'next-auth/providers/strava';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from './prisma';

const providers: NextAuthOptions['providers'] = [];

if (process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET) {
    // Reuses the same Strava API application (STRAVA_CLIENT_ID/SECRET) already
    // used for activity import (lib/strava.ts) -- Strava's OAuth apps are
    // scoped to a callback *domain*, not a specific redirect path, so this
    // login flow's callback (/api/auth/callback/strava) coexists fine with
    // the existing manual OAuth flow used for importing activities.
    providers.push(StravaProviderBase({
        clientId: process.env.STRAVA_CLIENT_ID,
        clientSecret: process.env.STRAVA_CLIENT_SECRET,
        // Strava's token-exchange response is non-standard: it embeds the full
        // athlete profile inline as an extra `athlete` field alongside the real
        // OAuth tokens. NextAuth passes the whole token response through to the
        // Prisma adapter's Account.create, which rejects any field that isn't
        // an actual Account column -- so without stripping it here, every
        // sign-in failed with "Unknown argument `athlete`." Do the exchange
        // manually and drop that field before NextAuth ever sees it.
        token: {
            async request({ params }) {
                const res = await fetch('https://www.strava.com/oauth/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        client_id: process.env.STRAVA_CLIENT_ID,
                        client_secret: process.env.STRAVA_CLIENT_SECRET,
                        code: params.code,
                        grant_type: 'authorization_code',
                    }),
                });
                if (!res.ok) throw new Error(`Strava token exchange failed: ${res.status}`);
                const { athlete: _athlete, ...tokens } = await res.json();
                return { tokens };
            },
        },
        // Strava's athlete endpoint returns numeric ids and no email; the base
        // provider's own profile() maps id straight through and sets email to
        // null (fine -- account linking here is by (provider, providerAccountId),
        // not email). Add athleteId, which isn't part of the base provider's
        // profile mapping but is a real column on our User model (links this
        // account to the existing athleteId-keyed caches: StravaActivityCache,
        // StravaActivityDetail, etc.) -- the Prisma adapter persists whatever
        // profile() returns, so this is enough to populate it at sign-in.
        profile(profile) {
            const athleteId = String(profile.id);
            return {
                id: athleteId,
                athleteId,
                name: `${profile.firstname} ${profile.lastname}`.trim() || `Athlete ${athleteId}`,
                email: null,
                image: profile.profile,
            } as any;
        },
    }));
}

// Optional second provider -- set GOOGLE_CLIENT_ID/SECRET to enable. Kept
// dynamic so the app doesn't need the google provider module loaded unless
// it's actually configured.
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    const GoogleProvider = require('next-auth/providers/google').default;
    providers.push(GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }));
}

export const authOptions: NextAuthOptions = {
    adapter: PrismaAdapter(prisma) as NextAuthOptions['adapter'],
    providers,
    session: { strategy: 'database' },
    callbacks: {
        // Default database-session callback only exposes name/email/image;
        // surface id + athleteId too so the client/API routes can key off them.
        async session({ session, user }) {
            if (session.user) {
                (session.user as any).id = user.id;
                (session.user as any).athleteId = (user as any).athleteId ?? null;
            }
            return session;
        },
    },
};
