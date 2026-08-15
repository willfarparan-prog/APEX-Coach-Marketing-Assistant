import { NextResponse, type NextRequest } from "next/server";

/**
 * Every page and API route except the cron jobs and the fal webhook is
 * unauthenticated otherwise — anyone with the URL could wipe reference
 * photos or approve posts. Cron routes and the fal webhook stay excluded
 * here because they already carry their own bearer/token check.
 *
 * Fails OPEN (no gate) if ADMIN_USER/ADMIN_PASSWORD aren't set, so a missing
 * env var doesn't lock out the owner before they've configured it — but that
 * also means the site stays unauthenticated until those vars are set.
 */
export function middleware(req: NextRequest) {
  const user = (process.env.ADMIN_USER ?? "").trim();
  const pass = (process.env.ADMIN_PASSWORD ?? "").trim();
  if (!user || !pass) return NextResponse.next();

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const [suppliedUser, suppliedPass] = atob(header.slice(6)).split(":");
    if (suppliedUser === user && suppliedPass === pass) return NextResponse.next();
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="APEX Engine"' },
  });
}

export const config = {
  matcher: ["/((?!api/cron|api/fal/webhook|_next/static|_next/image|favicon.ico).*)"],
};
