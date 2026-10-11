import { connection } from "next/server";
import { Brand } from "@/components/brand";
import { AuthForm } from "@/components/admin/auth-form";
export default async function SignIn() {
  await connection();
  return (
    <main id="main" className="auth-page">
      <Brand />
      <div className="panel">
        <AuthForm staff />
      </div>
    </main>
  );
}
