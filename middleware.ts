import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = Boolean(req.auth);
  const isLoginPage =
    nextUrl.pathname.startsWith("/sign-in") ||
    nextUrl.pathname.startsWith("/auth-gagal");
  const isApi = nextUrl.pathname.startsWith("/api/");
  // WhatsApp customer share: /?job=…&view=customer — no login required
  const isCustomerJobView =
    nextUrl.pathname === "/" &&
    nextUrl.searchParams.get("view")?.trim().toLowerCase() === "customer" &&
    Boolean(nextUrl.searchParams.get("job")?.trim());

  if (isLoginPage && isLoggedIn && nextUrl.pathname.startsWith("/sign-in")) {
    const raw = nextUrl.searchParams.get("callbackUrl") || "/";
    const target =
      raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
    return NextResponse.redirect(new URL(target, nextUrl));
  }

  if (!isLoggedIn && !isLoginPage && !isCustomerJobView && !isApi) {
    const loginUrl = new URL("/sign-in", nextUrl);
    loginUrl.searchParams.set(
      "callbackUrl",
      `${nextUrl.pathname}${nextUrl.search}`
    );
    return NextResponse.redirect(loginUrl);
  }

  const res = NextResponse.next();
  if (nextUrl.pathname === "/") {
    res.headers.set("Cache-Control", "private, no-store");
  }
  return res;
});

export const config = {
  matcher: [
    "/",
    "/((?!api/session|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|ws).*)",
  ],
};
