import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export default function NetflowLayout({ children }: { children: React.ReactNode }) {
  return <div className={inter.className}>{children}</div>;
}
