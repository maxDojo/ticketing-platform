import { organizerPage } from "@/modules/auth/page-access";
import { AdminShell } from "@/components/admin/shell";
import { AuthForm } from "@/components/admin/auth-form";
import { AccountSecurity } from "@/components/admin/account-security";
export default async function Security() {
  const actor = await organizerPage(true);
  return (
    <AdminShell>
      <div className="panel narrow">
        {actor.twoFactorEnabled && actor.mfaVerified ? (
          <AccountSecurity />
        ) : (
          <AuthForm enrollment enabled={actor.twoFactorEnabled} />
        )}
      </div>
    </AdminShell>
  );
}
