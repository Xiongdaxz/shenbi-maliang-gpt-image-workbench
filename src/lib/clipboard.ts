async function navigatorClipboardWriteAllowed(requireGrantedPermission: boolean) {
  if (!requireGrantedPermission || !navigator.permissions?.query) return true;
  try {
    const permission = await navigator.permissions.query({ name: "clipboard-write" as PermissionName });
    return permission.state === "granted";
  } catch {
    return true;
  }
}

export async function copyTextToClipboard(text: string, options: { requireGrantedPermission?: boolean } = {}) {
  if (!text) return false;
  if (navigator.clipboard?.writeText && await navigatorClipboardWriteAllowed(Boolean(options.requireGrantedPermission))) {
    try {
      let timeoutId = 0;
      const copied = await Promise.race([
        navigator.clipboard.writeText(text).then(() => true).catch(() => false),
        new Promise<boolean>((resolve) => {
          timeoutId = window.setTimeout(() => resolve(false), 600);
        })
      ]);
      if (timeoutId) window.clearTimeout(timeoutId);
      if (copied) return true;
    } catch {
      // Fall through to the legacy selection-based copy path.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}
