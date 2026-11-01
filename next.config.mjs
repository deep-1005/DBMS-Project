import path from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  outputFileTracingRoot: path.resolve('.'),
};

export default nextConfig;
