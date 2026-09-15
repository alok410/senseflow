import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Droplets, Loader2, ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setDeviceValveState, ValveStatus } from "@/lib/device-control.functions";

interface ValveControlDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deviceId: string;
  targetName?: string;
  currentStatus?: ValveStatus;
  targetAction: "on" | "off";
  onSuccess?: () => void;
  isMainMeter?: boolean;
}

const REASONS = [
  "Overdue Payment / Non-Payment",
  "Leak Detected / Emergency",
  "Maintenance & Plumbing Inspection",
  "Tenant Move-Out / Vacancy",
  "Consumer Requested",
  "Regular Schedule",
  "Other",
];

export function ValveControlDialog({
  open,
  onOpenChange,
  deviceId,
  targetName,
  currentStatus,
  targetAction,
  onSuccess,
  isMainMeter,
}: ValveControlDialogProps) {
  const [reasonCategory, setReasonCategory] = useState<string>(
    targetAction === "off" ? REASONS[0] : REASONS[4]
  );
  const [customNote, setCustomNote] = useState<string>("");
  const [mainMeterConfirmText, setMainMeterConfirmText] = useState<string>("");

  const setValveFn = useServerFn(setDeviceValveState);

  const valveMutation = useMutation({
    mutationFn: async () => {
      const fullReason = customNote.trim()
        ? `${reasonCategory}: ${customNote.trim()}`
        : reasonCategory;
      return await setValveFn({
        data: {
          deviceId,
          action: targetAction,
          reason: fullReason,
        },
      });
    },
    onSuccess: (res) => {
      toast.success(res.message || `Valve turned ${targetAction.toUpperCase()}`);
      onOpenChange(false);
      setCustomNote("");
      setMainMeterConfirmText("");
      onSuccess?.();
    },
    onError: (err: any) => {
      toast.error(err?.message || `Failed to turn ${targetAction.toUpperCase()} valve`);
    },
  });

  const isShuttingOff = targetAction === "off";
  const mainMeterLocked = isMainMeter && isShuttingOff && mainMeterConfirmText.trim().toUpperCase() !== "CONFIRM";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div
              className={`p-2.5 rounded-full ${
                isShuttingOff ? "bg-red-500/10 text-red-500" : "bg-emerald-500/10 text-emerald-500"
              }`}
            >
              {isShuttingOff ? (
                <AlertTriangle className="h-5 w-5" />
              ) : (
                <Droplets className="h-5 w-5" />
              )}
            </div>
            <div>
              <DialogTitle>
                {isShuttingOff ? "Turn OFF Valve (Stop Flow)" : "Turn ON Valve (Restore Flow)"}
              </DialogTitle>
              <DialogDescription>
                Device: <span className="font-mono font-medium text-foreground">{deviceId}</span>
                {targetName ? ` · ${targetName}` : ""}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {isMainMeter && isShuttingOff && (
          <div className="p-3.5 rounded-md border border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300 text-xs space-y-2">
            <div className="flex items-center gap-2 font-semibold">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              SITE-WIDE SHUTDOWN WARNING
            </div>
            <p>
              Turning off the Main Site Meter valve cuts off pressurized water to <strong>ALL consumers and blocks</strong> connected to this inlet.
            </p>
            <div className="pt-1">
              <Label className="text-xs font-medium">Type &quot;CONFIRM&quot; below to proceed:</Label>
              <Input
                value={mainMeterConfirmText}
                onChange={(e) => setMainMeterConfirmText(e.target.value)}
                placeholder="CONFIRM"
                className="mt-1 bg-background text-foreground h-8 text-xs font-mono uppercase"
              />
            </div>
          </div>
        )}

        <div className="space-y-3 py-2">
          {isShuttingOff && !isMainMeter && (
            <div className="p-3 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs">
              Water supply through this meter will be halted immediately upon command receipt.
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="reason-category">Reason / Purpose</Label>
            <Select value={reasonCategory} onValueChange={setReasonCategory}>
              <SelectTrigger id="reason-category">
                <SelectValue placeholder="Select reason" />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="custom-note">Notes (Optional)</Label>
            <Input
              id="custom-note"
              placeholder="e.g. Approved by Society President, Ticket #104"
              value={customNote}
              onChange={(e) => setCustomNote(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={valveMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={isShuttingOff ? "destructive" : "default"}
            disabled={valveMutation.isPending || !!mainMeterLocked}
            onClick={() => valveMutation.mutate()}
            className={
              !isShuttingOff
                ? "bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                : undefined
            }
          >
            {valveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isShuttingOff ? "Turn Valve OFF" : "Turn Valve ON"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
