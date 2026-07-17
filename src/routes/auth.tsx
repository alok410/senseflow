import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Droplets, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { requestLoginOtp, verifyLoginOtp } from "@/lib/otp.functions";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — SensorFlow" },
      { name: "description", content: "Sign in to SensorFlow with your mobile number." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { session } = useSession();
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    console.log("[auth] AuthPage mounted", { path: typeof window !== "undefined" ? window.location.pathname : "(ssr)" });
  }, []);

  useEffect(() => {
    if (session) navigate({ to: "/dashboard", replace: true });
  }, [session, navigate]);

  const normalizePhone = (raw: string) => {
    const trimmed = raw.trim().replace(/\s+/g, "");
    return trimmed.startsWith("+") ? trimmed : `+${trimmed.replace(/^0+/, "")}`;
  };

  const sendOtp = async (e: React.FormEvent) => {
    console.log("[auth] form onSubmit fired", { defaultPrevented: e.defaultPrevented });
    e.preventDefault();
    const p = normalizePhone(phone);
    console.log("[auth] Send OTP clicked", { rawPhone: phone, normalized: p });
    if (!/^\+\d{8,15}$/.test(p)) {
      console.warn("[auth] Invalid phone format", p);
      toast.error("Enter a valid phone number in international format (e.g. +919876543210).");
      return;
    }
    setLoading(true);
    const startedAt = performance.now();
    console.log("[auth] Calling requestLoginOtp…", { phone: p });
    try {
      const res = await requestLoginOtp({ data: { phone: p } });
      console.log("[auth] requestLoginOtp success", {
        phone: p,
        durationMs: Math.round(performance.now() - startedAt),
        response: res,
      });
      setPhone(p);
      setStep("otp");
      toast.success("OTP sent to your phone.");
    } catch (err) {
      console.error("[auth] requestLoginOtp failed", {
        phone: p,
        durationMs: Math.round(performance.now() - startedAt),
        error: err,
      });
      toast.error(err instanceof Error ? err.message : "Failed to send OTP.");
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp || otp.length !== 6) {
      toast.error("Enter the 6-digit OTP code.");
      return;
    }
    setLoading(true);
    try {
      const { tokenHash } = await verifyLoginOtp({ data: { phone, code: otp } });
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: "magiclink",
      });
      if (error) throw new Error(error.message);
      toast.success("Signed in.");
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <Droplets className="h-7 w-7 text-primary" />
          <span className="text-2xl font-bold">SensorFlow</span>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{step === "phone" ? "Sign in" : "Verify code"}</CardTitle>
            <CardDescription>
              {step === "phone"
                ? "Enter your mobile number to receive a one-time code."
                : `Enter the 6-digit code sent to ${phone}.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {step === "phone" ? (
              <form onSubmit={sendOtp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="phone">Mobile number</Label>
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="+91 98765 43210"
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={loading}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Include your country code (e.g. <code>+91</code> for India).
                  </p>
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={loading}
                  onClick={() =>
                    console.log("[auth] Send OTP button clicked", {
                      phoneState: phone,
                      loading,
                    })
                  }
                >
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Send OTP
                </Button>
              </form>
            ) : (
              <form onSubmit={verifyOtp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="otp">One-time code</Label>
                  <Input
                    id="otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                    disabled={loading}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Verify & sign in
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    setStep("phone");
                    setOtp("");
                  }}
                  disabled={loading}
                >
                  Change number
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}