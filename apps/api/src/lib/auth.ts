import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { env } from "./env";

export const hashPassword = async (password: string) => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
};

export const verifyPassword = async (password: string, hash: string) => {
  return bcrypt.compare(password, hash);
};

export type AuthToken = {
  userId: string;
  role: "ADMIN" | "ATTENDEE" | "SPEAKER";
};

export const signToken = (payload: AuthToken) => {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: "7d" });
};

export const verifyToken = (token: string) => {
  return jwt.verify(token, env.jwtSecret) as AuthToken;
};
