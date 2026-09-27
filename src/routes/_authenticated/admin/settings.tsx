import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Settings, CreditCard, Eye, EyeOff, CheckCircle2, XCircle, Loader2,
  Save, ExternalLink, ShieldCheck, Zap, AlertTriangle, Info,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useSession, useMyProfile } from "@/hooks/use-session";
import { ADMIN_NAV } from "@/lib/nav";
import {
  getAppSettings,
  upsertAppSettings,
  testRazorpayConnection,
  type AppSetting,
} from "@/lib/settings.functions";

export const Route = createFileRoute("/_authenticated/admin/settings")({
  component: AdminSettings,
});

function MaskedInput({
  value,
  onChange,
  placeholder,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  id: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-10 font-mono text-sm"
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        tabIndex={-1}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function AdminSettings() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const qc = useQueryClient();

  const getSettingsFn = useServerFn(getAppSettings);
  const upsertFn = useServerFn(upsertAppSettings);
  const testFn = useServerFn(testRazorpayConnection);

  // Local form state
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [testResult, setTestResult] = useState<{
    ok: boolean;
    mode?: string;
    error?: string;
  } | null>(null);

  // Load settings
  const settings = useQuery({
    queryKey: ["app-settings"],
    queryFn: async () => getSettingsFn({ data: undefined }) as Promise<AppSetting[]>,
  });

  // Populate form when settings load
  useEffect(() => {
    if (!settings.data) return;
    const map = new Map(settings.data.map((s) => [s.key, s.value ?? ""]));
    setKeyId(map.get("razorpay_key_id") ?? "");
    setKeySecret(map.get("razorpay_key_secret") ?? "");
    setEnabled((map.get("razorpay_enabled") ?? "false") === "true");
    setDirty(false);
  }, [settings.data]);

  // Save mutation
  const saveMut = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          settings: [
            { key: "razorpay_key_id", value: keyId.trim() },
            { key: "razorpay_key_secret", value: keySecret.trim() },
            { key: "razorpay_enabled", value: enabled ? "true" : "false" },
          ],
        },
      }),
    onSuccess: () => {
      toast.success("Settings saved successfully.");
      setDirty(false);
      setTestResult(null);
      qc.invalidateQueries({ queryKey: ["app-settings"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  // Test connection mutation
  const testMut = useMutation({
    mutationFn: async () => {
      // Save first so the test uses fresh values
      await upsertFn({
        data: {
          settings: [
            { key: "razorpay_key_id", value: keyId.trim() },
            { key: "razorpay_key_secret", value: keySecret.trim() },
          ],
        },
      });
      return testFn({ data: undefined }) as Promise<{ ok: boolean; mode?: string; error?: string }>;
    },
    onSuccess: (result) => {
      setTestResult(result);
      if (result.ok) {
        toast.success(`Razorpay connected! Mode: ${result.mode}`);
        qc.invalidateQueries({ queryKey: ["app-settings"] });
        setDirty(false);
      } else {
        toast.error(result.error ?? "Connection failed.");
      }
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Test failed"),
  });

  const isLive = keyId.startsWith("rzp_live_");
  const isTest = keyId.startsWith("rzp_test_");
  const hasKeys = keyId.trim().length > 0 && keySecret.trim().length > 0;

  const mark = (setter: (v: any) => void) => (v: any) => {
    setter(v);
    setDirty(true);
    setTestResult(null);
  };

  return (
    <DashboardLayout
      navItems={ADMIN_NAV}
      title="Settings"
      userName={profile?.full_name || null}
      userPhone={profile?.phone || null}
    >
      {settings.isLoading ? (
        <div className="flex items-center justify-center gap-3 py-24 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Loading settings\u2026</p>
        </div>
      ) : (
        <div className="max-w-2xl space-y-6">

          {/* Page header */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Settings className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Payment Gateway Settings</h2>
              <p className="text-sm text-muted-foreground">
                Configure Razorpay to enable online invoice payments for consumers.
              </p>
            </div>
          </div>

          {/* Razorpay card */}
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-950">
                    <CreditCard className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Razorpay</CardTitle>
                    <CardDescription>
                      Accept UPI, cards, net banking and wallets
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isLive && (
                    <Badge className="bg-green-600 hover:bg-green-600 text-white">
                      <Zap className="mr-1 h-3 w-3" />LIVE
                    </Badge>
                  )}
                  {isTest && (
                    <Badge variant="secondary">
                      <ShieldCheck className="mr-1 h-3 w-3" />TEST
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-5">
              {/* Enable toggle */}
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="text-sm font-medium">Enable online payments</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Consumers can pay invoices via Razorpay checkout
                  </p>
                </div>
                <Switch
                  id="razorpay-enabled"
                  checked={enabled}
                  onCheckedChange={mark(setEnabled)}
                />
              </div>

              <Separator />

              {/* Key ID */}
              <div className="space-y-2">
                <Label htmlFor="razorpay-key-id">
                  Key ID
                  <span className="ml-1 text-xs text-muted-foreground font-normal">(public)</span>
                </Label>
                <Input
                  id="razorpay-key-id"
                  value={keyId}
                  onChange={(e) => mark(setKeyId)(e.target.value)}
                  placeholder="rzp_test_xxxxxxxxxxxx or rzp_live_xxxxxxxxxxxx"
                  className="font-mono text-sm"
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">
                  Found in Razorpay Dashboard \u2192 Settings \u2192 API Keys
                </p>
              </div>

              {/* Key Secret */}
              <div className="space-y-2">
                <Label htmlFor="razorpay-key-secret">
                  Key Secret
                  <span className="ml-1 text-xs text-muted-foreground font-normal">(sensitive \u2014 stored encrypted)</span>
                </Label>
                <MaskedInput
                  id="razorpay-key-secret"
                  value={keySecret}
                  onChange={mark(setKeySecret)}
                  placeholder="Your Razorpay Key Secret"
                />
                <p className="text-xs text-muted-foreground">
                  Never share this. It is used server-side only for HMAC signature verification.
                </p>
              </div>

              {/* Connection test result */}
              {testResult && (
                <div
                  className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${
                    testResult.ok
                      ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300"
                      : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
                  }`}
                >
                  {testResult.ok ? (
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  )}
                  <div>
                    {testResult.ok ? (
                      <>
                        <p className="font-medium">Connected successfully</p>
                        <p className="text-xs mt-0.5">
                          Mode:{" "}
                          <span className="font-semibold capitalize">{testResult.mode}</span>
                          {testResult.mode === "live" && " \u2014 real payments will be processed"}
                          {testResult.mode === "test" && " \u2014 no real money will be charged"}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="font-medium">Connection failed</p>
                        <p className="text-xs mt-0.5">{testResult.error}</p>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Live mode warning */}
              {isLive && (
                <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20 p-3 text-sm text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <p>
                    <span className="font-semibold">Live mode active.</span> Real payments will be charged.
                    Make sure you have completed KYC on Razorpay before going live.
                  </p>
                </div>
              )}

              {/* Info box */}
              <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p>
                    Settings are stored in your Supabase database (admin-only access) and take effect
                    immediately \u2014 no server restart needed.
                  </p>
                  <p>
                    Get your API keys from{" "}
                    <a
                      href="https://dashboard.razorpay.com/app/website-app-settings/api-keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:text-foreground transition-colors"
                    >
                      Razorpay Dashboard \u2192 API Keys
                      <ExternalLink className="inline ml-0.5 h-3 w-3" />
                    </a>
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 pt-1">
                <Button
                  variant="outline"
                  onClick={() => testMut.mutate()}
                  disabled={testMut.isPending || !hasKeys}
                >
                  {testMut.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Zap className="mr-2 h-4 w-4" />
                  )}
                  Test connection
                </Button>
                <Button
                  onClick={() => saveMut.mutate()}
                  disabled={saveMut.isPending || !dirty}
                >
                  {saveMut.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Save settings
                </Button>
                {!dirty && testResult?.ok && (
                  <Badge variant="default" className="gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Saved
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Quick reference card */}
          <Card className="bg-muted/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Quick setup guide</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <div className="flex gap-2">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-[10px]">1</span>
                <p>Sign in to <a href="https://dashboard.razorpay.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 text-foreground">dashboard.razorpay.com</a></p>
              </div>
              <div className="flex gap-2">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-[10px]">2</span>
                <p>Go to <strong>Settings \u2192 API Keys</strong> and generate a new key pair</p>
              </div>
              <div className="flex gap-2">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-[10px]">3</span>
                <p>Copy the <strong>Key ID</strong> (starts with <code className="bg-muted px-1 rounded">rzp_test_</code>) and paste it above</p>
              </div>
              <div className="flex gap-2">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-[10px]">4</span>
                <p>Copy the <strong>Key Secret</strong> (shown only once) and paste it above</p>
              </div>
              <div className="flex gap-2">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-[10px]">5</span>
                <p>Click <strong>Test connection</strong> to verify, then <strong>Save settings</strong></p>
              </div>
              <div className="flex gap-2">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-[10px]">6</span>
                <p>Enable the toggle and save \u2014 consumers can now pay online!</p>
              </div>
            </CardContent>
          </Card>

        </div>
      )}
    </DashboardLayout>
  );
}
