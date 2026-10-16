import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { deleteAccount } from '@/lib/accountDeletion';
import { prisma } from '@/lib/prisma';
import { STRAVA_WRITE_SCOPE } from '@/lib/routeCredit';

async function sessionUserId(): Promise<string | undefined> {
    const session = await getServerSession(authOptions);
    return (session?.user as { id?: string } | undefined)?.id;
}

export async function GET() {
    const userId = await sessionUserId();
    if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { creditRoutesOnStrava: true } });
    const account = await prisma.account.findFirst({ where: { userId, provider: 'strava' }, select: { scope: true } });
    return NextResponse.json({
        hasStravaAccount: !!account,
        creditRoutesOnStrava: user?.creditRoutesOnStrava ?? false,
        canWriteToStrava: !!account?.scope?.includes(STRAVA_WRITE_SCOPE),
    });
}

export async function PATCH(req: Request) {
    const userId = await sessionUserId();
    if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

    const { creditRoutesOnStrava } = await req.json();
    if (typeof creditRoutesOnStrava !== 'boolean') return NextResponse.json({ error: 'creditRoutesOnStrava must be a boolean' }, { status: 400 });

    await prisma.user.update({ where: { id: userId }, data: { creditRoutesOnStrava } });
    return NextResponse.json({ creditRoutesOnStrava });
}

export async function DELETE() {
    const userId = await sessionUserId();
    if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

    try {
        await deleteAccount(userId);
        return NextResponse.json({ deleted: true });
    } catch (e) {
        console.error('Account deletion failed:', e);
        return NextResponse.json({ error: 'Account deletion failed. Please try again.' }, { status: 500 });
    }
}
