import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Azure SDK uses Node APIs (ws, https agents); keep it out of the bundle.
  serverExternalPackages: ["microsoft-cognitiveservices-speech-sdk"],
};

export default nextConfig;
