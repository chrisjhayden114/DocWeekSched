export type PasswordChangeInput = {
  currentPassword: string;
  password: string;
  confirmPassword: string;
};

/** Client-side checks before POST /auth/change-password. */
export function validatePasswordChange(input: PasswordChangeInput): string | null {
  if (!input.currentPassword) return "Enter your current password.";
  if (input.password.length < 8) return "New password must be at least 8 characters.";
  if (input.password !== input.confirmPassword) return "New password and confirmation don't match.";
  if (input.password === input.currentPassword) {
    return "New password must be different from your current password.";
  }
  return null;
}

export type AccountOrg = {
  id: string;
  name: string;
  role: string;
};

export type AccountPlanRow = {
  orgId: string;
  orgName: string;
  planName: string;
};

export function shouldShowOrgAccountSections(orgs: AccountOrg[] | null | undefined): boolean {
  return Boolean(orgs && orgs.length > 0);
}

export function orgRoleLabel(role: string): string {
  if (role === "OWNER") return "Owner";
  if (role === "ADMIN") return "Admin";
  if (role === "STAFF") return "Staff";
  return role;
}

export const EMAIL_CHANGE_COPY =
  "Email changes aren't self-service yet — write to support and we'll do it";

export const NOTIFICATION_DEFAULTS_COPY = "Per-event settings override these.";
