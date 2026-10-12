import { staffPage } from "@/modules/checkin/page";
import { AuthForm } from "@/components/admin/auth-form";
import { StaffShell } from "@/components/checkin/shell";
import { AccountSecurity } from "@/components/admin/account-security";
export default async function Security() {
  const actor = await staffPage(true);
  return (
    <StaffShell>
      <div className="panel narrow">
        {actor.twoFactorEnabled && actor.mfaVerified ? (
          <AccountSecurity staff />
        ) : (
          <AuthForm staff enrollment enabled={actor.twoFactorEnabled} />
        )}
      </div>
    </StaffShell>
  );
}
