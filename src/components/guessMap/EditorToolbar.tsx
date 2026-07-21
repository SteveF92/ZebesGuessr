import type { Cell } from '../../types';
import { cellKey } from '../../data';
import { DEFAULT_RATING } from '../../scoring';
import { RATING_COLORS } from './constants';
import { connBounds, connHorizontal, defaultLabelPos, LABEL_ARROW, LABEL_CYCLE } from './connectors';
import LandmarkEditor from '../LandmarkEditor';
import RoomStateExplorer from '../RoomStateExplorer';
import CellEditorPanel from './CellEditorPanel';
import type { MapEditor, Tool } from './useMapEditor';

const TOOLS: { id: Tool; label: string }[] = [
  { id: 'save', label: 'Save (S)' },
  { id: 'map', label: 'Map (M)' },
  { id: 'recharge', label: 'Recharge (R)' },
  { id: 'navigation', label: 'Nav' },
  { id: 'data', label: 'Data' },
  { id: 'ship', label: 'Ship' },
  { id: 'boss', label: 'Boss' },
  { id: 'item', label: 'Item' },
  { id: 'itemMajor', label: 'Major' },
  { id: 'chozo', label: 'Chozo' },
  { id: 'connector', label: 'Connector' },
  { id: 'roomname', label: 'Name' },
  { id: 'difficulty', label: 'Diff' },
  { id: 'landmark', label: 'Landmark' },
  { id: 'roomstate', label: 'Room state' },
  { id: 'cell', label: 'Cell' },
  { id: 'erase', label: 'Erase' }
];

interface Props {
  editor: MapEditor;
  game: string;
  areaId: string;
  mapStyle: string;
  /** hovered map cell (tile coords) — the Diff tool's hovered-rating readout */
  hover: Cell | null;
  /** every cell of the area, keyed "x,y" */
  cellSet: Set<string>;
}

/** The dev editor's toolbar (tool buttons + each tool's controls) and the
 *  Landmark / Room state side panels. Rendered only while editing. */
export default function EditorToolbar({ editor, game, areaId, mapStyle, hover, cellSet }: Props) {
  const { tool, overlays, selConn, updateOverlays } = editor;
  return (
    <>
      <div className="icon-editor">
        {TOOLS.filter((t) => t.id !== 'roomstate' || mapStyle === 'gba').map((t) => (
          <button key={t.id} className={`btn tiny ${tool === t.id ? 'active' : ''}`} onClick={() => editor.selectTool(t.id)}>
            {t.label}
          </button>
        ))}
        {tool === 'roomname' && (
          <>
            <input
              ref={editor.roomInputRef}
              className="edit-name"
              placeholder="room name"
              value={editor.roomInput}
              onChange={(ev) => editor.setRoomInput(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') editor.commitRoomPending();
                else if (ev.key === 'Escape') editor.setRoomPending(null);
              }}
            />
            <span className="edit-msg">{editor.roomPending ? 'type a name, Enter to fill' : editor.roomAnchor ? 'click opposite corner' : "click a room's start corner"}</span>
          </>
        )}
        {tool === 'difficulty' && (
          <>
            {[1, 2, 3, 4, 5, 6].map((r) => (
              <button
                key={r}
                className={`btn tiny ${editor.diffRating === r ? 'active' : ''}`}
                style={{
                  background: `rgba(${RATING_COLORS[r]}, ${editor.diffRating === r ? 0.9 : 0.45})`,
                  color: r === 6 ? '#eee' : '#111'
                }}
                title={r === 6 ? '6 — never served as a target' : `rating ${r} (1 easy … 5 hard)`}
                onClick={() => editor.setDiffRating(r)}
              >
                {r}
              </button>
            ))}
            <button className={`btn tiny ${editor.diffIsolate ? 'active' : ''}`} title="only tint cells matching the selected rating" onClick={() => editor.setDiffIsolate((v) => !v)}>
              Isolate
            </button>
            <span className="edit-msg">Show:</span>
            {[1, 2, 3, 4, 5, 6].map((r) => {
              const shown = editor.diffVisible.has(r);
              return (
                <button
                  key={r}
                  className={`btn tiny ${shown ? 'active' : ''}`}
                  style={{
                    background: `rgba(${RATING_COLORS[r]}, ${shown ? 0.75 : 0.15})`,
                    color: r === 6 ? '#eee' : '#111',
                    opacity: shown ? 1 : 0.5
                  }}
                  title={`${shown ? 'hide' : 'show'} rating ${r} in the tint`}
                  onClick={() =>
                    editor.setDiffVisible((prev) => {
                      const next = new Set(prev);
                      if (next.has(r)) next.delete(r);
                      else next.add(r);
                      return next;
                    })
                  }
                >
                  {r}
                </button>
              );
            })}
            <span className="edit-msg">
              {hover && cellSet.has(`${hover.x},${hover.y}`) ? `hovered: ${editor.diffEdits[editor.roomKeyAt(hover)] ?? `${DEFAULT_RATING} (unrated)`}` : 'click a cell to rate it'}
            </span>
          </>
        )}
        {tool === 'connector' && selConn !== null && overlays.connectors[selConn] && (
          <>
            <input
              className="edit-name"
              placeholder="destination area"
              value={overlays.connectors[selConn].label ?? ''}
              onChange={(ev) => {
                const label = ev.target.value;
                updateOverlays((o) => ({
                  connectors: o.connectors.map((c, i) => (i === selConn ? { ...c, label } : c))
                }));
              }}
            />
            <button
              className="btn tiny"
              title="Cycle the label around the connector's four sides"
              onClick={() => {
                updateOverlays((o) => ({
                  connectors: o.connectors.map((c, i) => {
                    if (i !== selConn) return c;
                    const cur = c.labelPos ?? defaultLabelPos(c);
                    const next = LABEL_CYCLE[(LABEL_CYCLE.indexOf(cur) + 1) % LABEL_CYCLE.length];
                    return { ...c, labelPos: next };
                  })
                }));
              }}
            >
              Label: {LABEL_ARROW[overlays.connectors[selConn].labelPos ?? defaultLabelPos(overlays.connectors[selConn])]}
            </button>
            {(() => {
              const b = connBounds(overlays.connectors[selConn]);
              // orientation is only ambiguous (and this override only matters)
              // for a single-cell connector
              if (b.maxX !== b.minX || b.maxY !== b.minY) return null;
              return (
                <button
                  className="btn tiny"
                  title="Flip a single-cell connector between horizontal and vertical"
                  onClick={() => {
                    updateOverlays((o) => ({
                      connectors: o.connectors.map((c, i) => (i === selConn ? { ...c, horizontal: !connHorizontal(c) } : c))
                    }));
                  }}
                >
                  Axis: {connHorizontal(overlays.connectors[selConn]) ? '↔' : '↕'}
                </button>
              );
            })()}
          </>
        )}
        {tool === 'landmark' && !editor.landmarkCell && <span className="edit-msg">click a cell to open its landmark view (X-Ray helps find the arenas)</span>}
        {tool === 'roomstate' && !editor.roomStateCell && <span className="edit-msg">click a cell to preview its room's Randovania render (X-Ray helps)</span>}
        {tool === 'cell' && !editor.cellPanelCell && <span className="edit-msg">click a cell to edit its walls/doors (persisted via mapOverrides)</span>}
        <button className="btn tiny save" onClick={editor.saveMap}>
          Save to file
        </button>
        {editor.saveMsg && <span className="edit-msg">{editor.saveMsg}</span>}
      </div>
      {tool === 'landmark' && editor.landmarkCell && <LandmarkEditor game={game} areaId={areaId} cell={editor.landmarkCell} />}
      {tool === 'roomstate' && editor.roomStateCell && (
        <RoomStateExplorer game={game} areaId={areaId} cell={editor.roomStateCell} roomName={editor.roomEdits[cellKey(areaId, editor.roomStateCell)]} roomCells={editor.roomStateCells} />
      )}
      {tool === 'cell' && editor.cellPanelCell && <CellEditorPanel editor={editor} game={game} areaId={areaId} mapStyle={mapStyle} />}
    </>
  );
}
