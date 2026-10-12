import { NextResponse, type NextRequest } from "next/server";

// Coarse gate: unauthenticated requests to app pages go to /login.
// Real session validation and authorisation happen server-side in
// src/lib/auth (requireUser / requireRole); this only checks cookie presence.
const SESSION_COOKIE = "sam_session";
const PUBLIC_PATHS = ["/login", "/api/health"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  if (!request.cookies.get(SESSION_COOKIE)?.value) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
