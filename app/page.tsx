import { redirect } from "next/navigation";

/**
 * The root route has no content of its own — it exists only to send a
 * visitor straight to the demo sign-in screen (see app/login/page.tsx).
 * Server-side redirect (Next.js App Router's `redirect()`), same
 * mechanism already used by every other page in this app when there's no
 * signed-in session (e.g. app/dashboard/page.tsx).
 */
export default function HomePage() {
  redirect("/login");
}
