import { enqueueAccountWelcome } from "@/lib/system-email";
import { processIdentityMail } from "@/lib/identity-mail";
import * as oidc from "openid-client";
import { cookies } from "next/headers";
import { NextRequest, NextResponse, after } from "next/server";
import {
  currentUser,
  digest,
  passwordHash,
  setSession,
  throttle,
} from "@/lib/auth";
import { query, mutate, pool } from "@/lib/db";
import { loginDestination } from "@/lib/login-redirect";
import { randomBytes } from "node:crypto";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const origin = process.env.APP_ORIGIN || req.nextUrl.origin;
  const callback = origin + "/api/auth/google";
  const jar = await cookies();
  if (jar.get("fleur_ghost")?.value)
    return NextResponse.redirect(
      new URL("/account?error=ghost_identity_blocked", origin),
    );
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
    return NextResponse.redirect(
      new URL("/login?error=google_not_configured", origin),
    );
  try {
    const config = await oidc.discovery(
      new URL("https://accounts.google.com"),
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );
    if (!req.nextUrl.searchParams.has("code")) {
      if (req.nextUrl.searchParams.has("error"))
        throw Error("provider_cancelled");
      const user = await currentUser(),
        link = req.nextUrl.searchParams.get("link") === "1";
      if (link && !user) throw Error("login_required");
      await throttle("google:" + req.headers.get("x-forwarded-for"), 30);
      const verifier = oidc.randomPKCECodeVerifier(),
        state = oidc.randomState(),
        nonce = oidc.randomNonce(),
        token = randomBytes(32).toString("hex");
      await mutate("DELETE FROM oauth_requests WHERE expires_at<NOW()");
      await mutate(
        "INSERT INTO oauth_requests(token_hash,state,verifier,nonce,next_path,link_user_id,expires_at) VALUES(?,?,?,?,?,?,DATE_ADD(NOW(),INTERVAL 10 MINUTE))",
        [
          digest(token),
          state,
          verifier,
          nonce,
          req.nextUrl.searchParams.get("next") || "",
          link ? user!.id : null,
        ],
      );
      jar.set("fleur_oauth", token, {
        httpOnly: true,
        secure: origin.startsWith("https:"),
        sameSite: "lax",
        maxAge: 600,
        path: "/api/auth/google",
      });
      return NextResponse.redirect(
        oidc.buildAuthorizationUrl(config, {
          redirect_uri: callback,
          scope: "openid email profile",
          code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
          code_challenge_method: "S256",
          state,
          nonce,
          prompt: "select_account",
        }),
      );
    }
    const token = jar.get("fleur_oauth")?.value;
    jar.delete("fleur_oauth");
    if (!token) throw Error("expired");
    const c = await pool.getConnection();
    let userId: number,
      next = "";
    try {
      await c.beginTransaction();
      const [rs]: any = await c.execute(
        "SELECT * FROM oauth_requests WHERE token_hash=? AND expires_at>NOW() FOR UPDATE",
        [digest(token)],
      );
      const flow = rs[0];
      if (!flow) throw Error("expired");
      await c.execute("DELETE FROM oauth_requests WHERE token_hash=?", [
        digest(token),
      ]);
      const tokens = await oidc.authorizationCodeGrant(
        config,
        new URL(callback + req.nextUrl.search),
        {
          pkceCodeVerifier: flow.verifier,
          expectedState: flow.state,
          expectedNonce: flow.nonce,
          idTokenExpected: true,
        },
      );
      const claims = tokens.claims();
      if (
        !claims ||
        claims.email_verified !== true ||
        typeof claims.email !== "string" ||
        typeof claims.sub !== "string"
      )
        throw Error("unverified");
      const [identities]: any = await c.execute(
        "SELECT u.id,u.active FROM auth_identities a JOIN users u ON u.id=a.user_id WHERE a.provider='google' AND a.subject=?",
        [claims.sub],
      );
      const [existing]: any = await c.execute(
        "SELECT id,active FROM users WHERE email=?",
        [claims.email.toLowerCase()],
      );
      const session = await currentUser();
      if (flow.link_user_id && session?.id !== flow.link_user_id)
        throw Error("login_required");
      if (identities[0]) {
        if (
          !identities[0].active ||
          (flow.link_user_id && identities[0].id !== flow.link_user_id)
        )
          throw Error("identity_conflict");
        userId = identities[0].id;
      } else {
        if (existing[0] && existing[0].id !== flow.link_user_id)
          throw Error("link_required");
        if (existing[0] && !existing[0].active) throw Error("disabled");
        if (flow.link_user_id) userId = flow.link_user_id;
        else {
          const [r]: any = await c.execute(
            "INSERT INTO users(name,email,password_hash,phone,address) VALUES(?,?,?,'','')",
            [
              String(claims.name || claims.email).slice(0, 100),
              claims.email.toLowerCase(),
              passwordHash(randomBytes(64).toString("hex")),
            ],
          );
          userId = r.insertId;
          await enqueueAccountWelcome(c,userId!);
        }
        await c.execute(
          "INSERT INTO auth_identities(user_id,provider,subject) VALUES(?,'google',?)",
          [userId, claims.sub],
        );
      }
      next = flow.next_path;
      await c.commit();
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
    await setSession(userId!);
    after(async()=>{await processIdentityMail();});
    return NextResponse.redirect(
      new URL(loginDestination(await currentUser(), next), origin),
    );
  } catch (e) {
    const known =
      e instanceof Error &&
      [
        "link_required",
        "login_required",
        "identity_conflict",
        "unverified",
      ].includes(e.message)
        ? e.message
        : "google_failed";
    return NextResponse.redirect(new URL("/login?error=" + known, origin));
  }
}
