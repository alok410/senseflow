export function canApproveInvoices(isAdmin: boolean, hasApprovalPermission: boolean): boolean {
  return isAdmin || hasApprovalPermission;
}