import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import { CreativeModal, CreativeContextPreview, ProfileEditor, ProfileSelectionFields } from "../CreativeProfiles";
import type { CreativeProfileKind, ProfileSelection } from "../../types";

export function ChatCreativeProfiles({ userId, value, onChange, disabled, open, onClose }: { userId: string; value: ProfileSelection; onChange: (value: ProfileSelection) => void; disabled: boolean; open: boolean; onClose: () => void }) {
  const { t } = useI18n(), [creating, setCreating] = useState<CreativeProfileKind | null>(null);
  useEffect(() => { if (!open) setCreating(null); }, [open]);
  const selected = Boolean(value.brandId || value.productId);
  const query = useQuery({ queryKey: ["creative-profile-context", userId, value], queryFn: ({ signal }) => api.resolveCreativeProfile(value, { signal }), enabled: selected });
  return <>
    {open ? <CreativeModal title={t("sets.tabProfiles")} className="chat-creative-profiles-dialog" onClose={onClose}><div className="sets-form"><p className="sets-hint">{t("sets.profileHint")}</p>
      <ProfileSelectionFields userId={userId} value={value} onChange={onChange} disabled={disabled} onNew={setCreating} />
      {query.data ? <CreativeContextPreview context={query.data.context} /> : null}
      {query.isError ? <p className="sets-error" role="alert">{query.error.message}</p> : null}
      <button className="primary-btn" type="button" onClick={onClose}>{t("sets.close")}</button>
    </div></CreativeModal> : null}
    {creating ? <ProfileEditor kind={creating} userId={userId} onClose={() => setCreating(null)} onSaved={p => { onChange(p.kind === "brand" ? { brandId: p.id } : { productId: p.id, brandId: p.brandId }); setCreating(null); }} /> : null}
  </>;
}
