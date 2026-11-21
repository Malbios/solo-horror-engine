import { h, type Child } from "./dom";

export type CardPreview = {
  /** Shows `title` and `body()` near `target` while it is hovered or keyboard-focused. */
  attach: (target: HTMLElement, title: string, body: () => readonly Child[]) => void;
  hide: () => void;
};

const GUTTER = 16;
const GAP = 8;
const CAN_HOVER = "(hover: hover) and (pointer: fine)";

/** Previews exist only where the device can hover; elsewhere the details open on tap instead. */
function canHover(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(CAN_HOVER).matches;
}

function supportsPopover(element: HTMLElement): boolean {
  return typeof element.showPopover === "function";
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

/** Above the target when it fits, else below; always inside the viewport. */
function place(element: HTMLElement, target: HTMLElement): void {
  const anchor = target.getBoundingClientRect();
  const box = element.getBoundingClientRect();
  const fitsAbove = anchor.top - GAP - box.height >= GUTTER;
  const top = fitsAbove ? anchor.top - GAP - box.height : anchor.bottom + GAP;
  const left = anchor.left + anchor.width / 2 - box.width / 2;
  element.style.top = `${clamp(top, GUTTER, window.innerHeight - GUTTER - box.height)}px`;
  element.style.left = `${clamp(left, GUTTER, window.innerWidth - GUTTER - box.width)}px`;
}

/** One shared preview element (a manual popover in the top layer, so scrolling panels never clip it). */
export function createCardPreview(element: HTMLElement): CardPreview {
  let owner: HTMLElement | null = null;

  const hide = () => {
    owner?.removeAttribute("aria-describedby");
    owner = null;
    if (supportsPopover(element) && element.matches(":popover-open")) element.hidePopover();
    element.hidden = true;
  };

  const show = (target: HTMLElement, title: string, body: () => readonly Child[]) => {
    if (!canHover()) return;
    element.replaceChildren(
      h("h2", { className: "card-preview-title", text: title }),
      ...body().filter((child) => child !== null),
    );
    element.hidden = false;
    if (supportsPopover(element) && !element.matches(":popover-open")) element.showPopover();
    place(element, target);
    owner?.removeAttribute("aria-describedby");
    owner = target;
    target.setAttribute("aria-describedby", element.id);
  };

  return {
    attach(target, title, body) {
      target.addEventListener("pointerenter", (event) => {
        if (event.pointerType !== "touch") show(target, title, body);
      });
      target.addEventListener("pointerleave", () => {
        if (owner === target) hide();
      });
      target.addEventListener("focusin", (event) => {
        if (event.target instanceof HTMLElement && event.target.matches(":focus-visible"))
          show(target, title, body);
      });
      target.addEventListener("focusout", () => {
        if (owner === target) hide();
      });
      target.addEventListener("click", hide);
    },
    hide,
  };
}
