import { describe, expect, it } from "vitest";
import {
  EMAIL_CHANGE_COPY,
  NOTIFICATION_DEFAULTS_COPY,
  orgRoleLabel,
  shouldShowOrgAccountSections,
  validatePasswordChange,
} from "../lib/accountSettings";

describe("password change form validation", () => {
  const valid = {
    currentPassword: "OldPass12!",
    password: "NewPass34!",
    confirmPassword: "NewPass34!",
  };

  it("accepts a well-formed change", () => {
    expect(validatePasswordChange(valid)).toBeNull();
  });

  it("requires the current password", () => {
    expect(validatePasswordChange({ ...valid, currentPassword: "" })).toBe(
      "Enter your current password.",
    );
  });

  it("requires the new password to be at least 8 characters", () => {
    expect(
      validatePasswordChange({ ...valid, password: "short", confirmPassword: "short" }),
    ).toBe("New password must be at least 8 characters.");
  });

  it("requires confirm to match", () => {
    expect(validatePasswordChange({ ...valid, confirmPassword: "OtherPass99!" })).toBe(
      "New password and confirmation don't match.",
    );
  });

  it("rejects a new password that is the same as the current one", () => {
    expect(
      validatePasswordChange({
        currentPassword: "SamePass12!",
        password: "SamePass12!",
        confirmPassword: "SamePass12!",
      }),
    ).toBe("New password must be different from your current password.");
  });
});

describe("account org sections", () => {
  it("hides plan/billing and organizations when the user has no memberships", () => {
    expect(shouldShowOrgAccountSections([])).toBe(false);
    expect(shouldShowOrgAccountSections(null)).toBe(false);
    expect(shouldShowOrgAccountSections(undefined)).toBe(false);
  });

  it("shows them when at least one org membership exists", () => {
    expect(shouldShowOrgAccountSections([{ id: "o1", name: "North", role: "OWNER" }])).toBe(true);
  });

  it("labels org roles in title case", () => {
    expect(orgRoleLabel("OWNER")).toBe("Owner");
    expect(orgRoleLabel("ADMIN")).toBe("Admin");
    expect(orgRoleLabel("STAFF")).toBe("Staff");
  });
});

describe("account copy", () => {
  it("keeps the honest email-change line (no self-service route)", () => {
    expect(EMAIL_CHANGE_COPY).toBe(
      "Email changes aren't self-service yet — write to support and we'll do it",
    );
  });

  it("says per-event settings override account defaults", () => {
    expect(NOTIFICATION_DEFAULTS_COPY).toBe("Per-event settings override these.");
  });
});
