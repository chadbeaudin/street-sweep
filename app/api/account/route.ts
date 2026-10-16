import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { deleteAccount } from '@/lib/accountDeletion';

export async function DELETE() {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

    try {
        await deleteAccount(userId);
        return NextResponse.json({ deleted: true });
    } catch (e) {
        console.error('Account deletion failed:', e);
        return NextResponse.json({ error: 'Account deletion failed. Please try again.' }, { status: 500 });
    }
}
