import Link from "next/link";
import { Brand } from "@/components/brand";
import { SignOut } from "./auth-form";
export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="admin-header">
        <Link href="/admin/events">
          <Brand />
        </Link>
        <nav>
          <Link href="/admin/events">Events</Link>
          <Link href="/admin/security">Security</Link>
          <SignOut />
        </nav>
      </header>
      <main id="main" className="workspace">
        {children}
      </main>
    </>
  );
}
