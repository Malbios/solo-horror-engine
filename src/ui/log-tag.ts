/** A scroller's scrollbar, measured in viewport pixels: its right edge and its width (0 when it has none). */
export type ScrollbarBox = { right: number; width: number };

/** How far the closed log tag must move left from the viewport's right edge to clear every scrollbar. */
export function tagClearance(viewportRight: number, scrollbars: readonly ScrollbarBox[]): number {
  return Math.max(
    0,
    ...scrollbars
      .filter((scrollbar) => scrollbar.width > 0)
      .map((scrollbar) => viewportRight - (scrollbar.right - scrollbar.width)),
  );
}
