import { redirect } from "next/navigation";

// Student Accounts was replaced by one account per group.
export default function StudentsPage() {
  redirect("/admin/group-accounts");
}
