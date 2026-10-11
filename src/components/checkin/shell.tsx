import Link from "next/link";
import { Brand } from "../brand";
import { SignOut } from "../admin/auth-form";
export function StaffShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="admin-header">
        <Link href="/staff">
          <Brand />
        </Link>
        <nav>
          <Link href="/staff">Assigned events</Link>
          <Link href="/staff/security">Security</Link>
          <SignOut staff />
        </nav>
      </header>
      <main id="main" className="workspace">
        {children}
      </main>
    </>
  );
}
