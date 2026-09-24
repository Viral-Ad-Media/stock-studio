/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // lib/engine/prompts.ts reads the methodology from the skill file at
    // runtime — make sure serverless bundles actually contain it.
    outputFileTracingIncludes: {
      "/api/engine/run": ["./.claude/skills/build-studies/SKILL.md"],
    },
  },
};

export default nextConfig;
