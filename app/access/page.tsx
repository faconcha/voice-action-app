import { accessAuthConfigured } from "@/app/lib/access-auth";

type AccessPageProps = {
  searchParams: Promise<{
    error?: string;
    redirect?: string;
  }>;
};

function errorCopy(error?: string) {
  if (error === "invalid") {
    return "Wrong password.";
  }

  if (error === "not-configured") {
    return "Access password is not configured.";
  }

  return null;
}

export default async function AccessPage({ searchParams }: AccessPageProps) {
  const params = await searchParams;
  const error = errorCopy(params.error);
  const configured = accessAuthConfigured();

  return (
    <main className="access-shell">
      <section className="access-panel" aria-labelledby="access-title">
        <p className="eyebrow">Voice Action App</p>
        <h1 id="access-title">Private access</h1>
        <p className="access-copy">
          This app is protected because it can create live OpenAI Realtime
          sessions.
        </p>

        {configured ? (
          <form className="access-form" action="/api/access/login" method="post">
            <input
              name="redirectTo"
              type="hidden"
              value={params.redirect && params.redirect.startsWith("/")
                ? params.redirect
                : "/"}
            />
            <label htmlFor="password">Password</label>
            <input
              autoComplete="current-password"
              autoFocus
              id="password"
              name="password"
              required
              type="password"
            />
            {error ? <p className="access-error">{error}</p> : null}
            <button type="submit">Enter</button>
          </form>
        ) : (
          <p className="access-error">
            Set APP_ACCESS_PASSWORD in Vercel and redeploy.
          </p>
        )}
      </section>
    </main>
  );
}
