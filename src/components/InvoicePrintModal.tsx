import { useRef } from "react";
import { format } from "date-fns";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Printer, X } from "lucide-react";
import type { InvoiceRow } from "@/lib/invoices.functions";

interface InvoicePrintModalProps {
  invoice: InvoiceRow | null;
  onClose: () => void;
  orgName?: string;
}

const fmtINR = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function statusColor(s: string) {
  if (s === "paid") return "#16a34a";
  if (s === "overdue") return "#dc2626";
  return "#d97706";
}

export function InvoicePrintModal({ invoice, onClose, orgName = "SenseFlow Water" }: InvoicePrintModalProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    if (!printRef.current) return;

    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) return;

    const content = printRef.current.innerHTML;

    printWindow.document.write(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Invoice – ${invoice?.id?.slice(0, 8).toUpperCase() ?? ""}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      background: #fff;
      color: #1a1a1a;
      font-size: 14px;
      line-height: 1.5;
    }
    .invoice-wrapper {
      max-width: 700px;
      margin: 0 auto;
      padding: 40px 32px;
    }
    /* Header */
    .inv-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 3px solid #2563eb;
      padding-bottom: 24px;
      margin-bottom: 28px;
    }
    .inv-org { font-size: 22px; font-weight: 700; color: #2563eb; letter-spacing: -0.5px; }
    .inv-org-sub { font-size: 12px; color: #64748b; margin-top: 2px; }
    .inv-badge {
      display: inline-block;
      padding: 4px 14px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #fff;
    }
    /* Meta row */
    .inv-meta {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 28px;
    }
    .inv-meta-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 14px 18px;
    }
    .inv-meta-label { font-size: 10px; text-transform: uppercase; color: #94a3b8; font-weight: 600; letter-spacing: 0.8px; margin-bottom: 4px; }
    .inv-meta-value { font-size: 15px; font-weight: 600; color: #0f172a; }
    .inv-meta-value.small { font-size: 13px; font-weight: 500; }
    /* Table */
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    thead tr { background: #2563eb; color: #fff; }
    thead th { padding: 10px 14px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600; }
    tbody tr { border-bottom: 1px solid #f1f5f9; }
    tbody tr:last-child { border-bottom: none; }
    tbody td { padding: 11px 14px; font-size: 13px; color: #374151; }
    tbody td.right { text-align: right; font-weight: 600; }
    /* Summary */
    .inv-summary {
      margin-left: auto;
      width: 280px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      overflow: hidden;
      margin-bottom: 28px;
    }
    .inv-summary-row { display: flex; justify-content: space-between; padding: 9px 16px; font-size: 13px; border-bottom: 1px solid #f1f5f9; }
    .inv-summary-row:last-child { border-bottom: none; background: #eff6ff; font-weight: 700; font-size: 15px; color: #1e40af; }
    .inv-summary-row .label { color: #64748b; }
    /* Footer */
    .inv-footer { border-top: 1px solid #e2e8f0; padding-top: 16px; display: flex; justify-content: space-between; align-items: center; }
    .inv-footer-note { font-size: 11px; color: #94a3b8; }
    .inv-id { font-size: 10px; color: #cbd5e1; font-family: monospace; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="invoice-wrapper">
    ${content}
  </div>
  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`);

    printWindow.document.close();
  };

  if (!invoice) return null;

  const statusStr = invoice.status.toUpperCase();
  const invId = `INV-${invoice.id.slice(0, 8).toUpperCase()}`;
  const periodStr = `${format(new Date(invoice.bill_period_start), "dd MMM yyyy")} – ${format(new Date(invoice.bill_period_end), "dd MMM yyyy")}`;

  return (
    <Dialog open={!!invoice} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/30 sticky top-0 z-10">
          <div>
            <p className="font-semibold text-sm">Invoice Preview</p>
            <p className="text-xs text-muted-foreground">{invId} · {periodStr}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-1.5" />
              Print / Save PDF
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Invoice content — rendered in the modal for preview */}
        <div className="px-8 py-6 bg-white text-black" ref={printRef}>
          {/* Header */}
          <div className="flex justify-between items-start border-b-[3px] border-blue-600 pb-6 mb-7">
            <div>
              <div className="text-2xl font-bold text-blue-600 tracking-tight">{orgName}</div>
              <div className="text-xs text-slate-500 mt-0.5">Smart Water Management</div>
            </div>
            <div className="text-right">
              <div className="text-xl font-bold text-slate-800">INVOICE</div>
              <div className="text-sm font-mono text-slate-500 mt-1">{invId}</div>
              <div
                className="inline-block mt-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider text-white"
                style={{ backgroundColor: statusColor(invoice.status) }}
              >
                {statusStr}
              </div>
            </div>
          </div>

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-4 mb-7">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
              <div className="text-[10px] uppercase text-slate-400 font-semibold tracking-widest mb-1">Billed To</div>
              <div className="font-semibold text-slate-800 text-base">{invoice.consumer_name || "Consumer"}</div>
              {invoice.consumer_phone && (
                <div className="text-sm text-slate-500 mt-0.5">{invoice.consumer_phone}</div>
              )}
              {invoice.block_id && (
                <div className="text-sm text-slate-500">Block: {invoice.block_id}</div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="text-[10px] uppercase text-slate-400 font-semibold tracking-widest mb-1">Bill Period</div>
                <div className="font-semibold text-slate-800 text-sm">{periodStr}</div>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="text-[10px] uppercase text-slate-400 font-semibold tracking-widest mb-1">Due Date</div>
                <div className="font-semibold text-slate-800 text-sm">
                  {format(new Date(invoice.due_date), "dd MMM yyyy")}
                </div>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="text-[10px] uppercase text-slate-400 font-semibold tracking-widest mb-1">Invoice Date</div>
                <div className="font-semibold text-slate-800 text-sm">
                  {format(new Date(invoice.created_at), "dd MMM yyyy")}
                </div>
              </div>
              {invoice.paid_at && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                  <div className="text-[10px] uppercase text-green-500 font-semibold tracking-widest mb-1">Paid On</div>
                  <div className="font-semibold text-green-700 text-sm">
                    {format(new Date(invoice.paid_at), "dd MMM yyyy")}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Line items table */}
          <table className="w-full text-sm mb-6 border border-slate-200 rounded-xl overflow-hidden">
            <thead>
              <tr className="bg-blue-600 text-white">
                <th className="text-left px-4 py-3 text-xs uppercase tracking-wider font-semibold">Description</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider font-semibold">Quantity</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider font-semibold">Rate</th>
                <th className="text-right px-4 py-3 text-xs uppercase tracking-wider font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="px-4 py-3 text-slate-700">
                  <div className="font-medium">Total Water Consumption</div>
                  <div className="text-xs text-slate-400">Meter reading for billing period</div>
                </td>
                <td className="px-4 py-3 text-right font-medium">{Number(invoice.consumption).toLocaleString("en-IN")} L</td>
                <td className="px-4 py-3 text-right text-slate-500">—</td>
                <td className="px-4 py-3 text-right font-semibold">—</td>
              </tr>
              <tr className="bg-green-50">
                <td className="px-4 py-3 text-slate-700">
                  <div className="font-medium text-green-700">Free Tier Allowance</div>
                  <div className="text-xs text-slate-400">Deducted from billable consumption</div>
                </td>
                <td className="px-4 py-3 text-right font-medium text-green-700">({Number(invoice.free_consumption).toLocaleString("en-IN")} L)</td>
                <td className="px-4 py-3 text-right text-slate-500">—</td>
                <td className="px-4 py-3 text-right font-semibold text-green-700">—</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-slate-700">
                  <div className="font-medium">Chargeable Consumption</div>
                  <div className="text-xs text-slate-400">Billed at ₹{Number(invoice.rate_applied).toFixed(4)}/L</div>
                </td>
                <td className="px-4 py-3 text-right font-medium">{Number(invoice.chargeable_consumption).toLocaleString("en-IN")} L</td>
                <td className="px-4 py-3 text-right text-slate-500">₹{Number(invoice.rate_applied).toFixed(4)}/L</td>
                <td className="px-4 py-3 text-right font-semibold">{fmtINR(Number(invoice.amount))}</td>
              </tr>
              {Number(invoice.late_fee) > 0 && (
                <tr className="bg-red-50">
                  <td className="px-4 py-3 text-slate-700">
                    <div className="font-medium text-red-700">Late Fee</div>
                  </td>
                  <td className="px-4 py-3 text-right">—</td>
                  <td className="px-4 py-3 text-right text-slate-500">—</td>
                  <td className="px-4 py-3 text-right font-semibold text-red-700">{fmtINR(Number(invoice.late_fee))}</td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Summary */}
          <div className="flex justify-end mb-7">
            <div className="w-72 border border-slate-200 rounded-xl overflow-hidden">
              <div className="flex justify-between px-4 py-2.5 text-sm border-b border-slate-100">
                <span className="text-slate-500">Water Charges</span>
                <span className="font-semibold">{fmtINR(Number(invoice.amount))}</span>
              </div>
              {Number(invoice.late_fee) > 0 && (
                <div className="flex justify-between px-4 py-2.5 text-sm border-b border-slate-100">
                  <span className="text-slate-500">Late Fee</span>
                  <span className="font-semibold text-red-600">{fmtINR(Number(invoice.late_fee))}</span>
                </div>
              )}
              <div className="flex justify-between px-4 py-3 bg-blue-50 font-bold text-blue-800">
                <span className="text-base">Total Amount</span>
                <span className="text-xl">{fmtINR(Number(invoice.total_amount))}</span>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-between items-center border-t border-slate-200 pt-4">
            <div className="text-xs text-slate-400">
              <p>Thank you for your payment.</p>
              <p>For queries, contact your water management office.</p>
            </div>
            <div className="text-right">
              <div className="text-[9px] font-mono text-slate-300">{invoice.id}</div>
              <div className="text-xs text-slate-400 mt-0.5">Generated by {orgName}</div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
