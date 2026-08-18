import { z } from "zod";

/** POST /auth/register only. Invite/join complete setup after this same form. */
export const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  role: z.enum(["ATTENDEE", "SPEAKER"]).default("ATTENDEE"),
  researchInterests: z.string().optional(),
  participantType: z.enum(["GRAD_STUDENT", "EDD_STUDENT", "PHD_STUDENT", "EDL_ALUMNI", "PROFESSOR"]).optional(),
  ageAttested: z.boolean().refine((v) => v === true, {
    message: "You must confirm you are 16 or older.",
  }),
});
