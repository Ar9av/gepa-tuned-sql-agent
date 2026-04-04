import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3', 'knex', 'pg', 'mysql2', 'mysql', 'tedious', 'oracledb', 'pg-query-stream', 'sqlite3'],
};

export default nextConfig;
