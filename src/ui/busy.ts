import { h } from "./dom";

export type Busy = {
  /** Locks the page behind a "working" overlay until `hide`. */
  show: (title: string) => void;
  hide: () => void;
};

const DETAIL = "Reading and checking every file. This can take a few seconds.";

/** Lets the browser paint (the overlay) before long synchronous work starts. */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

function closeTopLayer(element: HTMLElement): void {
  if (element instanceof HTMLDialogElement && element.open) element.close();
  if (element.hasAttribute("popover") && element.matches(":popover-open")) element.hidePopover();
}

/**
 * The overlay covers the page and makes everything behind it inert. Dialogs and popovers sit in the top layer
 * above any overlay, so they are closed first.
 */
export function createBusy(
  overlay: HTMLElement,
  blocked: readonly HTMLElement[],
  topLayer: readonly HTMLElement[],
): Busy {
  overlay.tabIndex = -1;
  return {
    show(title) {
      topLayer.forEach(closeTopLayer);
      overlay.replaceChildren(
        h("div", { className: "busy-card" }, [
          h("span", { className: "busy-spinner", attrs: { "aria-hidden": "true" } }),
          h("p", { className: "busy-title", text: title }),
          h("p", { className: "muted", text: DETAIL }),
        ]),
      );
      for (const element of blocked) element.inert = true;
      overlay.hidden = false;
      overlay.focus({ preventScroll: true });
    },
    hide() {
      overlay.hidden = true;
      for (const element of blocked) element.inert = false;
    },
  };
}
