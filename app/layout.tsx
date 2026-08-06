import Link from "next/link";
import "./globals.css";

export const metadata = { title: "APEX Engine" };

const navStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  maxWidth: 920,
  margin: "0 auto",
  padding: "18px",
  borderBottom: "1px solid var(--edge)",
};

const linkStyle = {
  color: "var(--ash)",
  textDecoration: "none",
  fontFamily: "var(--data)",
  fontSize: 12,
  letterSpacing: ".1em",
  textTransform: "uppercase" as const,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav aria-label="APEX Engine navigation" style={navStyle}>
          <Link href="/review" style={{ ...linkStyle, color: "var(--bone)", fontWeight: 600 }}>APEX Engine</Link>
          <div style={{ display: "flex", gap: 18 }}>
            <Link href="/review" style={linkStyle}>Review</Link>
            <Link href="/operations" style={linkStyle}>Operations</Link>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
