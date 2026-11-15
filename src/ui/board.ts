import type { Action, Board, GameView, Space, UnitState } from "../core";
import { h, svg } from "./dom";
import type { Labels } from "./labels";

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

function spaceButton(
  space: Space,
  shown: GameView,
  labels: Labels,
  targets: Map<string, Action>,
  handlers: BoardHandlers,
): HTMLButtonElement {
  const units = unitsOn(shown, space.id);
  const target = targets.get(space.id);
  const unitNames = units.map((unit) => labels.unit(unit.id));
  const description = [space.name, ...unitNames].join(", ");
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
      units.length === 0
        ? null
        : h(
            "span",
            { className: "space-units" },
            units.map((unit) => unitChip(unit, labels)),
          ),
    ],
  );
  if (space.position !== null) {
    button.style.left = `${space.position.x}%`;
    button.style.top = `${space.position.y}%`;
  }
  return button;
}

function edgeLines(shown: GameView, board: Board, spaces: readonly Space[]): SVGElement {
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
    return [
      svg("line", {
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
        class: "edge",
        "vector-effect": "non-scaling-stroke",
      }),
    ];
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
    edgeLines(shown, board, spaces),
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
