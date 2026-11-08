import { useMutation } from "@tanstack/react-query";
import { Eye, EyeOff, Wallet } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";

import { login } from "../api/auth";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { TextField } from "../components/ui/Field";
import { APP_NAME } from "../config";
import { ApiError } from "../lib/api";
import { getToken, safeNextPath, saveAuth } from "../lib/auth";

function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Wrong username or password.";
    if (error.status === 429) return "Too many failed attempts. Wait 15 minutes and try again.";
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    document.title = `Log in · ${APP_NAME}`;
  }, []);

  const mutation = useMutation({
    mutationFn: () => login(username.trim(), password),
    onSuccess: (data) => {
      saveAuth(data.access_token, data.expires_at);
      navigate(next, { replace: true });
    },
  });

  if (getToken()) return <Navigate to={next} replace />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid size-10 place-items-center rounded-xl bg-sidebar text-sidebar-active">
            <Wallet className="size-5" aria-hidden />
          </span>
          <span className="text-xl font-bold">{APP_NAME}</span>
        </div>

        <Card flush className="p-6 sm:p-7">
          <h1 className="text-xl font-bold">Welcome back</h1>
          <p className="mt-1 text-sm text-muted">Log in to see your money.</p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            <TextField
              label="Username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <TextField
              label="Password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              trailing={
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="grid size-9 place-items-center rounded-lg text-muted hover:text-ink"
                >
                  {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                </button>
              }
            />

            {mutation.isError && (
              <p role="alert" className="rounded-xl bg-pill-overdue px-3.5 py-2.5 text-sm font-medium text-pill-overdue-fg">
                {loginErrorMessage(mutation.error)}
              </p>
            )}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={mutation.isPending}
              disabled={!username.trim() || !password}
            >
              Log in
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
