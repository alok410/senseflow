import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Droplets, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { requestLoginOtp, verifyLoginOtp } from "@/lib/otp.functions";
import { GradientWave } from "@/components/ui/gradient-wave";

type Role = "admin" | "secretary" | "consumer";

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
  const [role, setRole] = useState<Role>("consumer");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (session) navigate({ to: "/dashboard", replace: true });
  }, [session, navigate]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "no-role") {
      toast.error("Your account has no role assigned. Contact your admin.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const normalizePhone = (raw: string) => {
    const trimmed = raw.trim().replace(/\s+/g, "");
    return trimmed.startsWith("+") ? trimmed : `+${trimmed.replace(/^0+/, "")}`;
  };

  const sendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = normalizePhone(phone);
    if (!/^\+\d{8,15}$/.test(p)) {
      toast.error("Enter a valid phone number in international format (e.g. +919876543210).");
      return;
    }
    setLoading(true);
    try {
      await requestLoginOtp({ data: { phone: p, role } });
      setPhone(p);
      setStep("otp");
      toast.success(`OTP sent for ${role} sign-in.`);
    } catch (err) {
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
      const { tokenHash } = await verifyLoginOtp({ data: { phone, code: otp, role } });
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: "magiclink",
      });
      if (error) throw new Error(error.message);
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem("sf_active_role", role);
      }
      toast.success("Signed in.");
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      <GradientWave className="opacity-70" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/30 via-background/50 to-background/80" />
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <Droplets className="h-7 w-7 text-primary" />
          <span className="text-2xl font-bold">SensorFlow</span>
        </div>
        <Card className="border-white/30 bg-card/70 shadow-2xl backdrop-blur-xl">
          <CardHeader>
            <CardTitle>{step === "phone" ? "Sign in" : "Verify code"}</CardTitle>
            <CardDescription>
              {step === "phone"
                ? "Enter your mobile number and pick the role you want to sign in as."
                : `Enter the 6-digit code sent to ${phone} for ${role} sign-in.`}
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
                <div className="space-y-2">
                  <Label>Sign in as</Label>
                  <Select value={role} onValueChange={(v) => setRole(v as Role)} disabled={loading}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="consumer">Consumer</SelectItem>
                      <SelectItem value="secretary">Secretary</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    We'll only send an OTP if this number has that role.
                  </p>
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
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
                  Change number or role
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
