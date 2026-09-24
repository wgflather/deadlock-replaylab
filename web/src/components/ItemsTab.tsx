import { useMemo, useRef, useState } from 'react'
import { itemOf, type ItemInfo } from '../abilities'
import { buildAt, type HeldItem, type ItemEvent } from '../demo/items'
import type { Timeline } from '../demo/types'
import { gameClock } from '../demo/usePlayback'
import { compact } from '../stats/format'

/**
 * The inspector's Items tab: what a player holds at the playhead, laid out by the shop's
 * three categories, and the purchases that got them there.
 *
 * Every item carries a tooltip -- its name, when it was bought, its tier and price, and
 * what it was upgraded from. One tooltip for the whole tab, placed under whichever item
 * the pointer or keyboard is on and kept inside the panel, rather than one per item:
 * the inspector clips what overflows it, and an item at either edge would otherwise
 * have its tooltip cut in half.
 */

const SLOTS = [
  ['weapon', 'Weapon'],
  ['vitality', 'Vitality'],
  ['spirit', 'Spirit'],
] as const

/** An item tile's size in pixels, the build's and the history's. */
const TILE = 34
const SMALL_TILE = 20
/** The tooltip's width in pixels, which placing it inside the panel needs to know. */
const TIP_WIDTH = 200

const slotColour = (slot: ItemInfo['slot']) => `var(--data-item-${slot})`

/** An item's glyph on a tile of its category's colour, the way the shop shows it. The
 * glyphs are white on transparency, so the tile is what gives them a ground. */
function ItemTile({ info, size }: { info: ItemInfo | undefined; size: number }) {
  const colour = info ? slotColour(info.slot) : 'var(--ui-line-strong)'
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-[4px] border"
      style={{
        width: size,
        height: size,
        borderColor: colour,
        background: `color-mix(in srgb, ${colour} 32%, var(--ui-inset))`,
      }}
    >
      {info?.icon ? (
        <img src={info.icon} alt="" draggable={false} className="h-[72%] w-[72%]" />
      ) : (
        <span className="text-ui-fg text-[0.625rem] font-bold">{info?.name[0] ?? '?'}</span>
      )}
    </span>
  )
}

type Tip = { item: HeldItem; left: number; top: number }

export function ItemsTab({
  timeline,
  player,
  at,
}: {
  timeline: Timeline
  player: number
  at: number
}) {
  // Items change a few dozen times a match: a whole second is fine enough.
  const second = Math.floor(at)
  const build = useMemo(() => buildAt(timeline, player, second), [timeline, player, second])
  const [tip, setTip] = useState<Tip | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const held = build.held.map((item) => ({ item, info: itemOf(item.id) }))
  const worth = held.reduce((total, { info }) => total + (info?.cost ?? 0), 0)

  /** Places the tooltip under `target`, centred on it but never past the panel's edge. */
  const show = (item: HeldItem, target: HTMLElement) => {
    const box = boxRef.current?.getBoundingClientRect()
    if (!box) return
    const tile = target.getBoundingClientRect()
    const centre = tile.left + tile.width / 2 - box.left
    setTip({
      item,
      left: Math.max(0, Math.min(centre - TIP_WIDTH / 2, box.width - TIP_WIDTH)),
      top: tile.bottom - box.top + 6,
    })
  }

  return (
    <div ref={boxRef} className="relative space-y-4 px-3 py-3">
      <p className="flex items-baseline gap-2">
        <span className="text-ui-muted text-[0.8125rem]">Build</span>
        <span className="text-ui-fg text-[0.9375rem] font-semibold tabular-nums">
          {held.length} {held.length === 1 ? 'item' : 'items'}
        </span>
        <span className="text-ui-muted text-[0.75rem]">{compact(worth)} souls</span>
      </p>

      <div className="space-y-2">
        {SLOTS.map(([slot, label]) => {
          const inSlot = held.filter(({ info }) => info?.slot === slot)
          return (
            <div key={slot} className="flex items-start gap-2">
              <span
                className="w-14 shrink-0 pt-2 text-[0.6875rem] font-medium"
                style={{ color: slotColour(slot) }}
              >
                {label}
              </span>
              {inSlot.length === 0 ? (
                <span className="text-ui-faint pt-2 text-[0.75rem]">—</span>
              ) : (
                <ul className="flex flex-wrap gap-1">
                  {inSlot.map(({ item, info }) => (
                    <li
                      key={item.id}
                      // Focusable, so the tooltip is there for a keyboard as well.
                      tabIndex={0}
                      aria-label={`${info?.name ?? 'Unknown item'}, bought at ${gameClock(timeline, item.boughtAt)}`}
                      onMouseEnter={(event) => show(item, event.currentTarget)}
                      onMouseLeave={() => setTip(null)}
                      onFocus={(event) => show(item, event.currentTarget)}
                      onBlur={() => setTip(null)}
                      className="focus-visible:outline-ui-accent rounded-[4px] outline-offset-1 focus-visible:outline-2"
                    >
                      <ItemTile info={info} size={TILE} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      {/* Items with no known category -- newer than the manifest -- still count. */}
      {held.some(({ info }) => !info) && (
        <p className="text-ui-muted text-[0.6875rem]">
          Some items are newer than this viewer's item list; run npm run assets:abilities.
        </p>
      )}

      <History history={build.history} timeline={timeline} />

      {tip && <Tooltip tip={tip} timeline={timeline} />}
    </div>
  )
}

function Tooltip({ tip, timeline }: { tip: Tip; timeline: Timeline }) {
  const info = itemOf(tip.item.id)
  const from = tip.item.upgradedFrom === null ? undefined : itemOf(tip.item.upgradedFrom)
  return (
    <div
      role="tooltip"
      className="ui-pop pointer-events-none absolute z-10 px-2.5 py-2"
      style={{ left: tip.left, top: tip.top, width: TIP_WIDTH }}
    >
      <p className="text-ui-fg text-[0.8125rem] leading-tight font-semibold">
        {info?.name ?? 'Unknown item'}
      </p>
      <p className="text-ui-muted mt-1 text-[0.75rem]">
        Bought at <span className="text-ui-fg tabular-nums">{gameClock(timeline, tip.item.boughtAt)}</span>
      </p>
      {info && (
        <p className="text-ui-muted text-[0.75rem]">
          <span style={{ color: slotColour(info.slot) }}>Tier {info.tier}</span> ·{' '}
          {compact(info.cost)} souls
        </p>
      )}
      {from && <p className="text-ui-muted text-[0.75rem]">Upgraded from {from.name}</p>}
    </div>
  )
}

const CHANGE_LABEL: Record<ItemEvent['change'], string> = {
  bought: 'bought',
  sold: 'sold',
  consumed: 'upgraded',
}

/** Every purchase and sale up to the playhead, newest first. */
function History({ history, timeline }: { history: ItemEvent[]; timeline: Timeline }) {
  return (
    <div>
      <h4 className="fact-label mb-1.5">Purchase history</h4>
      {history.length === 0 ? (
        <p className="text-ui-muted text-[0.75rem]">Nothing bought yet.</p>
      ) : (
        <ol className="max-h-56 space-y-0.5 overflow-y-auto pr-1">
          {[...history].reverse().map((event, i) => {
            const info = itemOf(event.id)
            return (
              <li
                key={`${event.seconds}-${event.id}-${i}`}
                className={`flex items-center gap-2 text-[0.75rem] ${
                  event.change === 'bought' ? '' : 'opacity-60'
                }`}
              >
                <span className="text-ui-muted w-9 shrink-0">{gameClock(timeline, event.seconds)}</span>
                <ItemTile info={info} size={SMALL_TILE} />
                <span
                  className={`min-w-0 flex-1 truncate ${event.change === 'sold' ? 'line-through' : ''} text-ui-muted`}
                >
                  {info?.name ?? 'Unknown item'}
                </span>
                <span
                  className={`shrink-0 text-[0.6875rem] ${
                    event.change === 'bought' ? 'text-ui-fg' : 'text-ui-muted'
                  }`}
                >
                  {CHANGE_LABEL[event.change]}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
