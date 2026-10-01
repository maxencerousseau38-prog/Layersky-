'use client';

import { signOut } from '@/app/login/actions';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  AvatarRoot,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from '@localize-infra/ui';
import { ChevronsUpDown, LogOut, Receipt, Settings } from 'lucide-react';
import Link from 'next/link';

/**
 * Who is signed in, and the way out.
 *
 * The shell had neither. There was no account identity anywhere — not in the
 * sidebar, not in the topbar — and no sign-out reachable from inside the
 * application: `signOut` existed in `app/login/actions.ts` and had no caller in
 * the shell. A reader could get in and had to clear a cookie to get out.
 *
 * The reference template puts this at the foot of the sidebar, under the
 * navigation, and that placement is the part worth taking: the account is not a
 * destination, so it does not belong among the destinations, and the foot is
 * where the eye stops rather than where it starts.
 *
 * Everything else is this product's own. `AvatarRoot`, `Menu*` and the sidebar
 * primitives already existed, so **no dependency was added** — the template's
 * version pulls `@radix-ui/react-avatar` and its own dropdown, both of which
 * `packages/ui` has been exporting since before this component was written.
 */
export function NavAccount({
  email,
  orgSlug,
}: {
  /** The signed-in address. Never a placeholder: absent means not rendered. */
  email: string;
  /** Null when the reader has no workspace yet, which hides the billing link. */
  orgSlug: string | null;
}) {
  const { setOpenMobile, isMobile } = useSidebar();

  /*
   * The local part, not the whole address.
   *
   * A sidebar is 256px wide and an address is routinely longer than that, so
   * the full string truncates to something that identifies nobody —
   * `maxence.rous…`. The part before the @ fits, and the full address is one
   * line below inside the menu, where there is room for it.
   */
  const handle = email.split('@')[0] ?? email;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <MenuRoot>
          <MenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-active"
              // The avatar is aria-hidden and the address is the only text, so
              // the button needs to say what it does rather than read as a
              // stray email address in the accessibility tree.
              aria-label={`Account menu for ${email}`}
            >
              <AvatarRoot name={handle} className="size-6" />
              <span className="grid min-w-0 flex-1 text-start leading-tight">
                <span className="truncate text-small font-medium text-primary">
                  {handle}
                </span>
                <span className="truncate text-micro text-tertiary">
                  Signed in
                </span>
              </span>
              <ChevronsUpDown
                aria-hidden="true"
                className="ms-auto size-3.5 text-tertiary"
              />
            </SidebarMenuButton>
          </MenuTrigger>

          <MenuContent
            // Above the trigger on desktop because the trigger is at the
            // bottom of a full-height column; beside it on a phone, where the
            // sidebar is a sheet and there is nothing below to open into.
            side={isMobile ? 'bottom' : 'top'}
            align="start"
            sideOffset={8}
            className="min-w-56"
          >
            {/* The full address, once, where it fits. */}
            <MenuLabel className="font-normal">
              <span className="block truncate text-small text-primary">
                {email}
              </span>
            </MenuLabel>
            <MenuSeparator />

            <MenuItem asChild>
              <Link href="/settings" onClick={() => setOpenMobile(false)}>
                <Settings aria-hidden="true" className="size-4" />
                Settings
              </Link>
            </MenuItem>

            {/*
             * Billing appears here and nowhere in the navigation.
             *
             * The page says "Paid plans are not priced yet" and nothing else. A
             * permanent sidebar entry for that is an advertisement for a
             * feature that does not exist; a line in the account menu is where
             * somebody would look for it, and costs nothing when they do not.
             */}
            {orgSlug ? (
              <MenuItem asChild>
                <Link
                  href={`/${orgSlug}/billing`}
                  onClick={() => setOpenMobile(false)}
                >
                  <Receipt aria-hidden="true" className="size-4" />
                  Billing
                </Link>
              </MenuItem>
            ) : null}

            <MenuSeparator />

            {/*
             * A form, not an onClick. `signOut` is a server action that clears
             * the session cookie and redirects; calling it from a click handler
             * would need a client-side wrapper for something the platform
             * already does, and would break without JavaScript.
             */}
            <form action={signOut}>
              <MenuItem asChild>
                <button type="submit" className="w-full">
                  <LogOut aria-hidden="true" className="size-4" />
                  Sign out
                </button>
              </MenuItem>
            </form>
          </MenuContent>
        </MenuRoot>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
