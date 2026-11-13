'use client';
import { useEffect } from 'react';
import { installGlobalErrorReporting } from '@/lib/clientErrors';

export default function ClientErrorReporter() {
    useEffect(() => installGlobalErrorReporting(), []);
    return null;
}
