/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@event-app/config", "@event-app/shared"],
  reactStrictMode: true,
};

module.exports = nextConfig;
