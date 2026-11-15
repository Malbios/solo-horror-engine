type Props = {
  className?: string;
  text?: string;
  attrs?: Record<string, string>;
  onClick?: () => void;
};

export type Child = Node | string | null;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props.className !== undefined) element.className = props.className;
  if (props.text !== undefined) element.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) element.setAttribute(name, value);
  if (element instanceof HTMLButtonElement) element.type = "button";
  const onClick = props.onClick;
  if (onClick !== undefined) element.addEventListener("click", () => onClick());
  element.append(...children.filter((child): child is Node | string => child !== null));
  return element;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function svg(
  tag: string,
  attrs: Record<string, string | number>,
  children: readonly Node[] = [],
): SVGElement {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
  element.append(...children);
  return element;
}

export function requireElement<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) {
    throw new Error(`Missing #${id}`);
  }
  return element;
}
