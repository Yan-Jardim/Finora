import type { NextConfig } from "next";

/**
 * Cabeçalhos de segurança básicos (sem CSP por enquanto: o Next injeta scripts inline e uma CSP correta pede nonces —
 * ver docs/FUTURE_IMPROVEMENTS.md). HSTS fica por conta da hospedagem (HTTPS).
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  // Permite abrir o app em desenvolvimento por outro dispositivo da rede local (ex.: celular).
  allowedDevOrigins: ["192.168.1.*"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
