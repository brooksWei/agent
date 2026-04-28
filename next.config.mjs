/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@zilliz/milvus2-sdk-node", "@modelcontextprotocol/sdk"],
};

export default nextConfig;
