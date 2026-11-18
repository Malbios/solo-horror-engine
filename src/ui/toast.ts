import type { ViewCard } from "../core";
import { h } from "./dom";
import type { Labels } from "./labels";
import type { Beat } from "./playback";

const MAX_VISIBLE = 3;
const LEAVE_MILLISECONDS = 200;

export type ToastHandlers = {
  onTap: () => void;
  openCard: (card: ViewCard) => void;
};

/** The texts a beat's toast shows: the resolved card's name first, then the lines. */
export function toastTexts(beat: Beat, labels: Labels): string[] {
  return beat.card === null ? beat.lines : [labels.card(beat.card), ...beat.lines];
}

const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function leave(toast: HTMLElement): void {
  if (!toast.isConnected) return;
  if (reducedMotion()) {
    toast.remove();
    return;
  }
  toast.classList.add("toast-leaving");
  window.setTimeout(() => toast.remove(), LEAVE_MILLISECONDS);
}

/**
 * Shows a toast describing a beat for `duration` milliseconds, below the older ones (which dim);
 * at most a few stay visible. Tapping its text goes on to the next beat.
 */
export function showToast(
  region: HTMLElement,
  beat: Beat,
  labels: Labels,
  duration: number,
  handlers: ToastHandlers,
): void {
  const { card } = beat;
  const timer = h("span", { className: "toast-timer", attrs: { "aria-hidden": "true" } });
  timer.style.animationDuration = `${duration}ms`;
  const toast = h("div", { className: "toast" }, [
    card === null
      ? null
      : h("button", {
          className: "toast-card",
          text: labels.card(card),
          onClick: () => handlers.openCard(card),
        }),
    beat.lines.length === 0
      ? null
      : h(
          "button",
          { className: "toast-text", onClick: handlers.onTap },
          beat.lines.map((line) => h("span", { className: "toast-line", text: line })),
        ),
    timer,
  ]);
  for (const older of region.querySelectorAll(".toast")) older.classList.add("toast-old");
  region.append(toast);
  const visible = [...region.querySelectorAll<HTMLElement>(".toast:not(.toast-leaving)")];
  for (const extra of visible.slice(0, Math.max(0, visible.length - MAX_VISIBLE))) leave(extra);
  window.setTimeout(() => leave(toast), duration);
}

export function clearToasts(region: HTMLElement): void {
  region.replaceChildren();
}
