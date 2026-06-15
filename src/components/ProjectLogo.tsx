import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { DEFAULT_LOGO_URL, normalizePublicBranding } from "../lib/branding";
import { cx } from "../lib/cx";

const BRANDING_LOGO_STALE_TIME_MS = 10 * 60 * 1000;

export function ProjectLogo({ className, alt }: { className?: string; alt?: string }) {
  const brandingQuery = useQuery({
    queryKey: ["branding"],
    queryFn: api.branding,
    staleTime: BRANDING_LOGO_STALE_TIME_MS,
    refetchOnMount: false
  });
  const branding = normalizePublicBranding(brandingQuery.data);
  const [src, setSrc] = useState(branding.logoUrl || DEFAULT_LOGO_URL);

  useEffect(() => {
    setSrc(branding.logoUrl || DEFAULT_LOGO_URL);
  }, [branding.logoUrl]);

  return <img className={cx("project-logo", className)} src={src} alt={alt ?? branding.siteName} onError={() => setSrc(DEFAULT_LOGO_URL)} />;
}
