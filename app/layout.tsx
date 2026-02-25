import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { StarknetWalletProvider } from "@/components/StarknetWalletProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cairo Verifiers Toolkit",
  description: "Compile circuits, generate Cairo verifiers, and test full end-to-end ZK proofs on Starknet.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable}`}
        style={{
          margin: 0,
          minHeight: '100vh',
          background: '#020617',
          color: '#e2e8f0',
          fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
          overflow: 'hidden',
        }}
      >
        <StarknetWalletProvider>
          {children}
        </StarknetWalletProvider>
      </body>
    </html>
  );
}
