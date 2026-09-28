import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireOrganizer, AccessError } from "./access";
export async function organizerPage(enrollment = false) {
  try {
    return await requireOrganizer(await headers(), enrollment);
  } catch (error) {
    if (error instanceof AccessError) {
      if (error.status === 401) redirect("/admin/sign-in");
      if (!enrollment) redirect("/admin/security");
      redirect("/admin/sign-in?access=denied");
    }
    throw error;
  }
}
