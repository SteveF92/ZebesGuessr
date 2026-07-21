import type { Cell, Connector } from '../../types';

export type Overlays = { connectors: Connector[] };

/** label-position cycle order for the editor toggle */
export type LabelPos = NonNullable<Connector['labelPos']>;
export const LABEL_CYCLE: LabelPos[] = ['above', 'right', 'below', 'left'];
export const LABEL_ARROW: Record<LabelPos, string> = {
  above: 'above ↑',
  below: 'below ↓',
  left: 'left ←',
  right: 'right →'
};

/** geometry helpers: connectors are axis-aligned between two whole map cells */
export function connBounds(c: Connector) {
  return {
    minX: Math.min(c.x0, c.x1),
    maxX: Math.max(c.x0, c.x1),
    minY: Math.min(c.y0, c.y1),
    maxY: Math.max(c.y0, c.y1)
  };
}
/** true when the connector runs left-right (wider than it is tall). For a
 *  single cell (neither axis dominates) an explicit `horizontal` wins;
 *  otherwise the label side breaks the tie, so a 1-cell connector labelled
 *  left/right renders as a horizontal stub. The override exists for the one
 *  case the label can't cover: a horizontal stub labelled above/below. */
export function connHorizontal(c: Connector) {
  const b = connBounds(c);
  const dx = b.maxX - b.minX,
    dy = b.maxY - b.minY;
  if (dx !== dy) return dx > dy;
  if (c.horizontal !== undefined) return c.horizontal;
  return c.labelPos === 'left' || c.labelPos === 'right';
}
export function connContains(c: Connector, cell: Cell) {
  const b = connBounds(c);
  return cell.x >= b.minX && cell.x <= b.maxX && cell.y >= b.minY && cell.y <= b.maxY;
}
export function defaultLabelPos(c: Connector): LabelPos {
  return connHorizontal(c) ? 'right' : 'below';
}
/** build a connector from two clicks, locking to the dominant axis */
export function connectorFromDrag(a: Cell, c: Cell): Connector {
  if (Math.abs(c.x - a.x) >= Math.abs(c.y - a.y)) {
    return { x0: Math.min(a.x, c.x), y0: a.y, x1: Math.max(a.x, c.x), y1: a.y, label: '' };
  }
  return { x0: a.x, y0: Math.min(a.y, c.y), x1: a.x, y1: Math.max(a.y, c.y), label: '' };
}
