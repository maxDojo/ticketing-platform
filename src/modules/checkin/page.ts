import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireStaffAccount } from "./http";
import { AccessError } from "../auth/access";
export async function staffPage(enrollment = false) {
  try {
    return await requireStaffAccount(await headers(), enrollment);
  } catch (error) {
    if (error instanceof AccessError) {
      if (error.status === 401) redirect("/staff/sign-in");
      if (!enrollment) redirect("/staff/security");
      redirect("/staff/sign-in?access=denied");
    }
    throw error;
  }
}
