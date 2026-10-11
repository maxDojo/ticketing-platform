import { staffPage } from "@/modules/checkin/page";
import { AuthForm } from "@/components/admin/auth-form";
import { StaffShell } from "@/components/checkin/shell";
export default async function Security() {
  const actor = await staffPage(true);
  return (
    <StaffShell>
      <div className="panel narrow">
        <AuthForm staff enrollment enabled={actor.twoFactorEnabled} />
      </div>
    </StaffShell>
  );
}
