import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import ServiceWorkerRegister from './ServiceWorkerRegister';

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
    title: "StreetSweep",
    description: "Find and route the streets you haven't ridden yet.",
    applicationName: "StreetSweep",
    appleWebApp: {
        capable: true,
        title: "StreetSweep",
        statusBarStyle: "black-translucent",
    },
    icons: {
        icon: "/icon.svg",
        apple: "/apple-touch-icon.png",
    },
};

export const viewport: Viewport = {
    themeColor: "#FC4C02",
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: "cover",
};

import packageJson from '../package.json';

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className={inter.className}>
                {children}
                <ServiceWorkerRegister />
                <div className="fixed bottom-4 left-4 text-[11px] font-medium text-gray-500/80 bg-white/30 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/40 shadow-sm pointer-events-none z-[9999]">
                    v{packageJson.version}
                </div>
            </body>
        </html>
    );
}
