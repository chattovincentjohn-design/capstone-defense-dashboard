import { AdminConsole } from "@/components/admin/admin-console";

export const metadata = { title: "Student Accounts · CDEMS" };

export default function StudentsPage() {
  return <AdminConsole initialTab="students" />;
}
