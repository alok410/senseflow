import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { RotateCcw, Loader2, AlertCircle } from "lucide-react";
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
import { resetDevice } from "@/lib/device-control.functions";

interface ResetDeviceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deviceId: string;
  targetName?: string;
  onSuccess?: () => void;
}

export function ResetDeviceDialog({
  open,
  onOpenChange,
  deviceId,
  targetName,
  onSuccess,
}: ResetDeviceDialogProps) {
  const [reason, setReason] = useState<string>("");
  const resetFn = useServerFn(resetDevice);

  const resetMutation = useMutation({
    mutationFn: async () => {
      return await resetFn({
        data: {
          deviceId,
          reason: reason.trim() || "Manual hardware reset",
        },
      });
    },
    onSuccess: (res) => {
      toast.success(res.message || "Device reset command sent successfully");
      onOpenChange(false);
      setReason("");
      onSuccess?.();
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to reset device");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-full bg-blue-500/10 text-blue-500">
              <RotateCcw className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Reset SenseFlow Device</DialogTitle>
              <DialogDescription>
                Device: <span className="font-mono font-medium text-foreground">{deviceId}</span>
                {targetName ? ` · ${targetName}` : ""}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="p-3 rounded-md bg-muted/60 text-xs text-muted-foreground flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <span>
              This clears device-side fault states and restarts firmware logic. It does <strong>not</strong> change the current valve position.
            </span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reset-reason">Reason (Optional)</Label>
            <Input
              id="reset-reason"
              placeholder="e.g. Cleared stuck reading / Routine reboot"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={resetMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={resetMutation.isPending}
            onClick={() => resetMutation.mutate()}
          >
            {resetMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirm Reset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
