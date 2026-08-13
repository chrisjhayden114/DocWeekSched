/** ONB-A: attendee first-run welcome. All four gates must pass. */
export function shouldShowWelcome(opts: {
  role?: string | null;
  welcomeSeenAt?: string | null;
  isAdmin: boolean;
}): boolean {
  return opts.role === "ATTENDEE" && opts.welcomeSeenAt === null && !opts.isAdmin;
}
