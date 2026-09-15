import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Droplets, Loader2 } from "lucide-react";
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
import { batchSetDeviceValveState } from "@/lib/device-control.functions";

interface BatchValveControlDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deviceIds: string[];
  targetAction: "on" | "off";
  onSuccess?: () => void;
}

const REASONS = [
  "Overdue Non-Payment Enforcement",
  "Scheduled Pipeline Maintenance",
  "Emergency Leak Quarantine",
  "Society Batch Reconnect",
  "Other",
];

export function BatchValveControlDialog({
  open,
  onOpenChange,
  deviceIds,
  targetAction,
  onSuccess,
}: BatchValveControlDialogProps) {
  const [reasonCategory, setReasonCategory] = useState<string>(
    targetAction === "off" ? REASONS[0] : REASONS[3]
  );
  const [notes, setNotes] = useState<string>("");

  const qc = useQueryClient();
  const batchValveFn = useServerFn(batchSetDeviceValveState);

  const batchMutation = useMutation({
    mutationFn: async () => {
      const fullReason = notes.trim()
        ? `${reasonCategory}: ${notes.trim()}`
        : reasonCategory;
      return await batchValveFn({
        data: {
          deviceIds,
          action: targetAction,
          reason: fullReason,
        },
      });
    },
    onSuccess: (res) => {
      if (res.failed.length === 0) {
        toast.success(`Successfully turned ${targetAction.toUpperCase()} ${res.succeeded.length} valves.`);
      } else {
        toast.warning(
          `Turned ${targetAction.toUpperCase()} ${res.succeeded.length} valves, ${res.failed.length} failed.`
        );
      }
      onOpenChange(false);

      const newStatus = targetAction === "on" ? "open" : "closed";
      const now = new Date().toISOString();
      const reason = notes.trim() ? `${reasonCategory}: ${notes.trim()}` : reasonCategory;

      if (typeof window !== "undefined") {
        try {
          const saved = JSON.parse(localStorage.getItem("senseflow_valve_states") || "{}");
          for (const id of res.succeeded) {
            saved[id] = {
              deviceId: id,
              valveStatus: newStatus,
              lastAction: targetAction,
              lastActionAt: now,
              lastActionReason: reason,
            };
          }
          localStorage.setItem("senseflow_valve_states", JSON.stringify(saved));
        } catch (e) {}
      }

      qc.setQueriesData({ queryKey: ["admin-device-states"] }, (old: any) => {
        const next = { ...(old || {}) };
        for (const id of res.succeeded) {
          next[id] = {
            deviceId: id,
            valveStatus: newStatus,
            lastAction: targetAction,
            lastActionAt: now,
            lastActionReason: reason,
          };
        }
        return next;
      });

      qc.invalidateQueries({ queryKey: ["admin-device-states"] });
      qc.invalidateQueries({ queryKey: ["secretary-device-states"] });

      onSuccess?.();
    },
    onError: (err: any) => {
      toast.error(err?.message || `Failed to batch turn ${targetAction.toUpperCase()} valves`);
    },
  });

  const isShuttingOff = targetAction === "off";

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
                Batch {isShuttingOff ? "Close" : "Open"} Valves ({deviceIds.length} devices)
              </DialogTitle>
              <DialogDescription>
                Execute {targetAction.toUpperCase()} command on {deviceIds.length} selected meters.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="max-h-28 overflow-y-auto p-2 bg-muted/50 rounded text-xs font-mono flex flex-wrap gap-1">
            {deviceIds.map((id) => (
              <span key={id} className="bg-background px-1.5 py-0.5 rounded border">
                {id}
              </span>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="batch-reason">Reason</Label>
            <Select value={reasonCategory} onValueChange={setReasonCategory}>
              <SelectTrigger id="batch-reason">
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
            <Label htmlFor="batch-notes">Notes</Label>
            <Input
              id="batch-notes"
              placeholder="e.g. Mass cutoff for pending reminders"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={batchMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={isShuttingOff ? "destructive" : "default"}
            disabled={batchMutation.isPending}
            onClick={() => batchMutation.mutate()}
            className={
              !isShuttingOff
                ? "bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                : undefined
            }
          >
            {batchMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirm Batch {isShuttingOff ? "Turn OFF" : "Turn ON"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
