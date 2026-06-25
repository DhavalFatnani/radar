import type { ReactNode } from "react";
import { auth, signOut } from "@/lib/auth";
import { Rail } from "@/app/components/shell/rail";
import { Topbar } from "@/app/components/shell/topbar";
import { AppFrame } from "@/app/components/shell/app-frame";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth();

  const signOutAction = (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <button type="submit" className="btn btn-ghost">
        Sign out
      </button>
    </form>
  );

  return (
    <AppFrame rail={<Rail />}>
      <Topbar
        actions={
          <>
            <span className="op-email">{session?.user?.email}</span>
            {signOutAction}
          </>
        }
      />
      <main className="v2-content">{children}</main>
    </AppFrame>
  );
}
