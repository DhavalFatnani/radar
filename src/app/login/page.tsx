import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — Radar" };

export default function LoginPage() {
  return (
    <main>
      <h1>Operator sign in</h1>
      <LoginForm />
    </main>
  );
}
