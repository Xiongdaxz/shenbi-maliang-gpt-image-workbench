/** Lock the foreground comparison without changing the background gallery width. */
export function lockImageComparePageScroll() {
  const root = document.documentElement;
  const body = document.body;
  const previous = {
    rootOverflow: root.style.overflow,
    bodyOverflow: body.style.overflow,
    gutter: root.style.scrollbarGutter,
    paddingRight: body.style.paddingRight
  };
  const gutterWidth = Math.max(0, window.innerWidth - root.getBoundingClientRect().width);
  const paddingRight = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
  if (gutterWidth > 0) body.style.paddingRight = `${paddingRight + gutterWidth}px`;
  root.style.overflow = "hidden";
  body.style.overflow = "hidden";
  root.style.scrollbarGutter = "auto";

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    root.style.overflow = previous.rootOverflow;
    body.style.overflow = previous.bodyOverflow;
    root.style.scrollbarGutter = previous.gutter;
    body.style.paddingRight = previous.paddingRight;
  };
}

export function isReturningFromImageCompare(previousPath: string, nextPath: string) {
  return previousPath === "/images/compare" && nextPath === "/images";
}
