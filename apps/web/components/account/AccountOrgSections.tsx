import Link from "next/link";
import {
  orgRoleLabel,
  shouldShowOrgAccountSections,
  type AccountOrg,
  type AccountPlanRow,
} from "../../lib/accountSettings";

export function AccountPlanBillingCard({
  orgs,
  plans,
}: {
  orgs: AccountOrg[];
  plans: AccountPlanRow[];
}) {
  if (!shouldShowOrgAccountSections(orgs)) return null;
  return (
    <section className="card" data-account-section="plan-billing" style={{ marginTop: 24, padding: 20 }}>
      <h2 className="text-display-sm" style={{ marginTop: 0 }}>
        Plan &amp; billing
      </h2>
      <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>
        {orgs.map((org) => {
          const plan = plans.find((p) => p.orgId === org.id);
          return (
            <li key={org.id}>
              {org.name}
              {plan?.planName ? ` — ${plan.planName}` : ""}
            </li>
          );
        })}
      </ul>
      <p style={{ margin: 0 }}>
        <Link href="/organizer/billing">Manage plan &amp; billing →</Link>
      </p>
    </section>
  );
}

export function AccountOrganizationsCard({ orgs }: { orgs: AccountOrg[] }) {
  if (!shouldShowOrgAccountSections(orgs)) return null;
  return (
    <section className="card" data-account-section="organizations" style={{ marginTop: 24, padding: 20 }}>
      <h2 className="text-display-sm" style={{ marginTop: 0 }}>
        Your organizations
      </h2>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {orgs.map((org) => (
          <li key={org.id}>
            <Link href="/organizer">{org.name}</Link>
            {" — "}
            {orgRoleLabel(org.role)}
          </li>
        ))}
      </ul>
    </section>
  );
}
