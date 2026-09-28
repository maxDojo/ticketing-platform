import { Brand } from "@/components/brand";
import { AuthForm } from "@/components/admin/auth-form";
import { connection } from "next/server";
export default async function SignIn() {
  await connection();
  return (
    <main id="main" className="auth-page">
      <Brand />
      <div className="panel">
        <AuthForm />
      </div>
    </main>
  );
}
