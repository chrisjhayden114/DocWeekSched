import dotenv from "dotenv";

dotenv.config();

export const env = {
  databaseUrl: process.env.DATABASE_URL || "",
  jwtSecret: process.env.JWT_SECRET || "dev-secret",
  adminInviteCode: process.env.ADMIN_INVITE_CODE || "",
  apiPort: Number(process.env.PORT || process.env.API_PORT || 4000),
  webBaseUrl: process.env.WEB_BASE_URL || "http://localhost:3000",
};

if (!env.databaseUrl) {
  console.warn("DATABASE_URL is not set. Prisma will fail to connect.");
}
