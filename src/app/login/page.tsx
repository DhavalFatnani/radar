import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Wordmark } from "@/app/components/ui/wordmark";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — Radar" };

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <main className="auth">
      <div className="auth-shell">
        <Wordmark />
        <div className="auth-card">
          <h1 className="auth-title">Operator sign in</h1>
          <p className="auth-subcopy">Enter your credentials to continue.</p>
          <LoginForm />
        </div>
        <Link href="/" className="btn-quiet auth-back">
          ← Back to home
        </Link>
      </div>
    </main>
  );
}
