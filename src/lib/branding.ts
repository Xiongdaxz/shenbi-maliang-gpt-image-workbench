import { useEffect } from "react";
import type { PublicBranding } from "../types";
import { DEFAULT_LOGIN_ASSETS, normalizeLoginAssets } from "./loginAssets";
import { publicAssetPath } from "./publicAssets";

export const DEFAULT_SITE_NAME = "神笔马良";
export const DEFAULT_LOGO_URL = publicAssetPath("/image/logo.png");

export const DEFAULT_PUBLIC_BRANDING: PublicBranding = {
  siteName: DEFAULT_SITE_NAME,
  logoUrl: DEFAULT_LOGO_URL,
  faviconUrl: DEFAULT_LOGO_URL,
  loginAssets: DEFAULT_LOGIN_ASSETS
};

export function normalizePublicBranding(branding?: Partial<PublicBranding> | null): PublicBranding {
  const siteName = branding?.siteName?.trim() || DEFAULT_SITE_NAME;
  return {
    siteName,
    logoUrl: branding?.logoUrl || DEFAULT_LOGO_URL,
    faviconUrl: branding?.faviconUrl || branding?.logoUrl || DEFAULT_LOGO_URL,
    loginAssets: normalizeLoginAssets(branding?.loginAssets ?? DEFAULT_LOGIN_ASSETS)
  };
}

function ensureFaviconLink() {
  const existing = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
  if (existing) return existing;
  const link = document.createElement("link");
  link.rel = "icon";
  document.head.appendChild(link);
  return link;
}

export function applyDocumentBranding(branding: PublicBranding) {
  document.title = branding.siteName || DEFAULT_SITE_NAME;
  const favicon = branding.faviconUrl || branding.logoUrl || DEFAULT_LOGO_URL;
  const link = ensureFaviconLink();
  if (link.href !== favicon) {
    link.href = favicon;
  }
}

export function useDocumentBranding(branding?: Partial<PublicBranding> | null) {
  useEffect(() => {
    applyDocumentBranding(normalizePublicBranding(branding));
  }, [branding]);
}
