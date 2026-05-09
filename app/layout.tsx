import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
    title: "StreetSweep",
    description: "Generate optimized bike routes",
    icons: {
        icon: "/icon.svg",
    },
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
                <div className="fixed bottom-4 left-4 text-[11px] font-medium text-gray-500/80 bg-white/30 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/40 shadow-sm pointer-events-none z-[9999]">
                    v{packageJson.version}
                </div>
            </body>
        </html>
    );
}
