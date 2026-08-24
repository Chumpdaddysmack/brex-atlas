import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Sparkles, Lock } from "lucide-react";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const schema = z.object({
  password: z.string().min(1, "Password required"),
});

type FormValues = z.infer<typeof schema>;

export default function Login() {
  const [, setLocation] = useLocation();
  const [error, setError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const res = await apiRequest("POST", "/api/login", values);
      return res.json();
    },
    onSuccess: () => {
      setError(null);
      // Invalidate the auth-status query so the app re-checks and unlocks
      queryClient.invalidateQueries({ queryKey: ["/api/auth/status"] });
      setLocation("/");
    },
    onError: async (err: any) => {
      // apiRequest throws on non-2xx; message contains server error
      const msg = err?.message ?? "Login failed";
      setError(msg);
    },
  });

  function onSubmit(values: FormValues) {
    setError(null);
    mutation.mutate(values);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs text-muted-foreground mb-4">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            Brex Atlas
          </div>
          <h1 className="font-serif text-3xl tracking-tight text-center">
            Sign in
          </h1>
          <p className="mt-2 text-sm text-muted-foreground text-center">
            Enter the password to access the workspace.
          </p>
        </div>

        <Card className="p-6">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-4"
              autoComplete="off"
            >
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        autoComplete="current-password"
                        autoFocus
                        data-testid="input-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={mutation.isPending}
                data-testid="button-signin"
              >
                <Lock className="mr-2 h-4 w-4" />
                {mutation.isPending ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </Form>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Authorized users only.
        </p>
      </div>
    </div>
  );
}
