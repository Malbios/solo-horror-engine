import type { Action, Board, GameView, Space, UnitState } from "../core";
import { h, svg } from "./dom";
import { describeMarkFrom, type Labels, type MarkedEdge } from "./labels";

export type BoardHandlers = {
  takeAction: (action: Action) => void;
  showSpace: (space: Space) => void;
};

function unitsOn(shown: GameView, space: string): UnitState[] {
  return Object.values(shown.units).filter(
    (unit) => unit.placement.type === "space" && unit.placement.space === space,
  );
}

function moveTargets(actions: readonly Action[]): Map<string, Action> {
  return new Map(
    actions.flatMap((action) => (action.type === "moveTo" ? [[action.space, action]] : [])),
  );
}

function unitChip(unit: UnitState, labels: Labels): HTMLElement {
  const name = labels.unit(unit.id);
  return h("span", { className: "unit-chip", text: name.slice(0, 1), attrs: { title: name } });
}

function marksAt(space: string, labels: Labels): MarkedEdge[] {
  return labels
    .markedEdges()
    .filter((marked) => marked.edge.fromSpace === space || marked.edge.toSpace === space);
}

function markChip(marked: MarkedEdge, space: string, labels: Labels): HTMLElement {
  const chip = h("span", {
    className: "mark-chip",
    text: marked.mark.badge,
    attrs: { title: describeMarkFrom(marked, space, labels) },
  });
  if (marked.mark.color !== null) chip.style.borderColor = marked.mark.color;
  return chip;
}

function spaceButton(
  space: Space,
  shown: GameView,
  labels: Labels,
  targets: Map<string, Action>,
  handlers: BoardHandlers,
): HTMLButtonElement {
  const units = unitsOn(shown, space.id);
  const marks = marksAt(space.id, labels);
  const target = targets.get(space.id);
  const unitNames = units.map((unit) => labels.unit(unit.id));
  const markNames = marks.map((marked) => describeMarkFrom(marked, space.id, labels));
  const description = [space.name, ...unitNames, ...markNames].join(", ");
  const button = h(
    "button",
    {
      className: target === undefined ? "space" : "space space-target",
      attrs: {
        "aria-label": target === undefined ? description : `Move to ${description}`,
      },
      onClick: () =>
        target === undefined ? handlers.showSpace(space) : handlers.takeAction(target),
    },
    [
      h("span", { className: "space-name", text: space.name }),
      units.length === 0 && marks.length === 0
        ? null
        : h("span", { className: "space-units" }, [
            ...units.map((unit) => unitChip(unit, labels)),
            ...marks.map((marked) => markChip(marked, space.id, labels)),
          ]),
    ],
  );
  if (space.position !== null) {
    button.style.left = `${space.position.x}%`;
    button.style.top = `${space.position.y}%`;
  }
  return button;
}

function edgeLines(
  shown: GameView,
  board: Board,
  spaces: readonly Space[],
  labels: Labels,
): SVGElement {
  const markOf = new Map(labels.markedEdges().map((marked) => [marked.edge.id, marked.mark]));
  const positions = new Map(
    spaces.flatMap((space) =>
      space.position !== null && space.position.board === board.id
        ? [[space.id, space.position]]
        : [],
    ),
  );
  const lines = Object.values(shown.edges).flatMap((edge) => {
    const from = positions.get(edge.fromSpace);
    const to = positions.get(edge.toSpace);
    if (from === undefined || to === undefined) return [];
    const mark = markOf.get(edge.id);
    const line = svg("line", {
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      class: mark === undefined ? "edge" : "edge edge-marked",
      "vector-effect": "non-scaling-stroke",
    });
    const color = mark?.color ?? null;
    if (color !== null) line.style.stroke = color;
    return [line];
  });
  return svg(
    "svg",
    {
      class: "board-edges",
      viewBox: "0 0 100 100",
      preserveAspectRatio: "none",
      "aria-hidden": "true",
    },
    lines,
  );
}

function renderBoard(
  board: Board,
  spaces: readonly Space[],
  shown: GameView,
  labels: Labels,
  targets: Map<string, Action>,
  handlers: BoardHandlers,
): HTMLElement {
  const onBoard = spaces.filter((space) => space.position?.board === board.id);
  const surface = h("div", { className: "board-surface" }, [
    board.image === null
      ? null
      : h("img", { className: "board-image", attrs: { src: board.image, alt: "" } }),
    edgeLines(shown, board, spaces, labels),
    ...onBoard.map((space) => spaceButton(space, shown, labels, targets, handlers)),
  ]);
  surface.style.setProperty("--aspect", String(board.aspect));
  return h("figure", { className: "board", attrs: { "aria-label": board.name } }, [surface]);
}

/** The map: each board with its spaces as buttons, plus a plain list for spaces without a position. */
export function renderMap(
  shown: GameView,
  actions: readonly Action[],
  labels: Labels,
  handlers: BoardHandlers,
): HTMLElement[] {
  const spaces = labels.spaces();
  const boards = labels.boards();
  const targets = moveTargets(actions);
  const boardIds = new Set(boards.map((board) => board.id));
  const loose = spaces.filter(
    (space) => space.position === null || !boardIds.has(space.position.board),
  );
  return [
    ...boards.map((board) => renderBoard(board, spaces, shown, labels, targets, handlers)),
    ...(loose.length === 0
      ? []
      : [
          h(
            "div",
            { className: "space-list" },
            loose.map((space) => spaceButton(space, shown, labels, targets, handlers)),
          ),
        ]),
  ];
}
