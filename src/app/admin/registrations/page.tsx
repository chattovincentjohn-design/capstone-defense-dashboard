import { AdminConsole } from "@/components/admin/admin-console";

export const metadata = { title: "Registrations · CDEMS" };

export default function RegistrationsPage() {
  return <AdminConsole initialTab="registrations" />;
}
