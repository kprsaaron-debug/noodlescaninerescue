import type { UserSignupEvent, UserValidateEvent } from "@netlify/functions";
import { allowedEmails, isEmailAllowed } from "../../lib/auth.js";

// Only the people listed in ADMIN_EMAILS can create a dashboard account.
// If the list is empty, accounts can still be created by inviting people
// from the Netlify UI (invited users are allowed through).
const shouldDeny = (email?: string | null, invited?: boolean) => {
  if (invited) return false;
  if (allowedEmails().length === 0) return true;
  return !isEmailAllowed(email);
};

export default {
  userValidate(event: UserValidateEvent) {
    if (shouldDeny(event.user.email, !!event.user.invitedAt)) return event.deny();
  },
  userSignup(event: UserSignupEvent) {
    if (shouldDeny(event.user.email, !!event.user.invitedAt)) return event.deny();
  },
};
