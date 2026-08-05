"use client";

import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

export default function LoginPage() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const result = await signIn("credentials", {
      username,
      password,
      redirect: false,
      callbackUrl,
    });
    setBusy(false);
    if (!result || result.error) {
      setError("Username atau password salah.");
      return;
    }
    window.location.href = result.url || callbackUrl;
  }

  return (
    <main className="app app-login">
      <section className="login-card">
        <h1>TU-PRIMA</h1>
        <p>Silakan login untuk mengakses dashboard. Akun disimpan di sheet Users (Excel).</p>
        <form className="form" onSubmit={onSubmit}>
          <label>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? "Masuk..." : "Login"}
          </button>
        </form>
      </section>
    </main>
  );
}
