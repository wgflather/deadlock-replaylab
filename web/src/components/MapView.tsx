import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AMBER,
  creepsAt,
  lanesAt,
  objectivesAt,
  pairBaseGuardians,
  SAPPHIRE,
  spotsAt,
  TEAM_SHORT_NAMES,
  type Timeline,
} from '../demo/types'
import {
  castsAt,
  CAST_LINGER,
  DEATH_LINGER,
  FIRE_TAIL,
  firingAt,
  KILL_FEED_LINGER,
  KILL_FEED_MAX,
  killFeed,
  killsAt,
  lingerFor,
} from '../demo/events'
import { heroIcon } from '../heroes'
import {
  breakablesAt,
  breakableSpots,
  powerupsAt,
  campHistories,
  campsAt,
  respawnDelays,
  riftAt,
  RIFT_RADIUS,
  urnAt,
} from '../demo/mapState'
import { EventMarks } from './EventLayer'
import { KillFeed } from './KillFeed'
import {
  CampGlyph,
  CrateGlyph,
  DropoffGlyph,
  MapTimers,
  RiftGlyph,
  SinnerGlyph,
  PowerupGlyph,
  POWERUP_NAMES,
  SnackGlyph,
  StatueGlyph,
  UrnGlyph,
} from './MapTimers'
import { ObjectiveIcon } from './ObjectiveIcon'
import shopIcon from '../assets/map/shop.png'
import { ZiplineLayer } from './ZiplineLayer'
import { objectiveColours, type ViewAs } from '../map/palette'
import { belowGroundFor, MAP_IMAGE_RADIUS, minimapFor, worldToMap } from '../map'
import type { Below } from '../map/below'

const MIN_ZOOM = 1
/** The zoom from which "when zoomed" details -- crates, statues -- are drawn. */
const DETAIL_ZOOM = 2.5

/** How a small, numerous kind of map detail is shown: always, only once zoomed in far
 * enough to have room for it, or not at all. */
type Detail = 'always' | 'zoomed' | 'hidden'

/**
 * Which map layer is drawn. The game's own minimap shows the streets, or -- while you
 * are below them -- the area under the middle or the tunnels instead. "auto" does that
 * for the hero being followed (or, failing that, inspected); the others hold one layer.
 */
type MapLayer = 'auto' | 'streets' | Below

const MAP_LAYERS: [MapLayer, string][] = [
  ['auto', 'Auto'],
  ['streets', 'Streets'],
  ['underground', 'Underground'],
  ['tunnels', 'Tunnels'],
]

/** How much of the streets still shows under a below-ground layer: enough to say where
 * on the map the passages run, not so much that it reads as the streets themselves. */
const STREETS_UNDER = 0.18

/** A breakable list with nothing in it, for matches from before tough crates. */
const EMPTY = { t: [], x: [], y: [], broken: [], by: [] }

/** How a taken spot is drawn when `ghosts` keeps it on the map: greyed and faint, the
 * way a camp that is down is hollow -- still there to see where it comes back. */
const GHOST = { filter: 'grayscale(1)', opacity: 0.55 } as const

/** The neutral team: whose the underground shops are. */
const NEUTRAL_TEAM = 4

function shown(detail: Detail, zoom: number) {
  return detail === 'always' || (detail === 'zoomed' && zoom >= DETAIL_ZOOM)
}
/** How long the pointer rests before the controls fade out during playback. */
const IDLE_MS = 2500
/** Pixels a press has to move before it is a drag rather than a click. */
const DRAG_THRESHOLD = 4
const MAX_ZOOM = 10
/** A focused area fills this share of the frame, leaving room to see who arrives. */
const FOCUS_FILL = 0.7
/** The least radius a focus is framed at, in world units: a 1v1 fought on one spot
 * still wants its lane around it, not a 10x close-up of two faces. */
const FOCUS_MIN_RADIUS = 1200

/** A request to frame part of the map: a centre and radius in world units. A new object
 * is a new request, so the same fight clicked twice frames it again. */
export type MapFocus = { x: number; y: number; radius: number }
/** Marker width in pixels, held constant on screen however far the map is zoomed. */
const MARKER = 30
/** A view cone's reach from the player's centre, and its full width, in pixels and
 * degrees. Wide enough to read a heading at a glance from across the map; about the
 * spread of a third-person camera's useful view, not a precise field of view. */
const CONE_REACH = 40
const CONE_WIDTH = 60

/** The cone as an SVG path, pointing right (+x) from the origin; the marker turns it. */
const CONE_PATH = (() => {
  const half = ((CONE_WIDTH / 2) * Math.PI) / 180
  const x = CONE_REACH * Math.cos(half)
  const y = CONE_REACH * Math.sin(half)
  return `M0 0L${x} ${-y}A${CONE_REACH} ${CONE_REACH} 0 0 1 ${x} ${y}Z`
})()
/** A muzzle flash: a small four-point burst just outside the portrait's rim on the +x
 * side, which the cone layer's rotation turns to face where the player looks. */
const MUZZLE_PATH = (() => {
  const at = MARKER / 2 + 5
  return `M${at - 5} 0L${at - 1} -2L${at} -6L${at + 1} -2L${at + 7} 0L${at + 1} 2L${at} 6L${at - 1} 2Z`
})()
/** A creep's width in pixels -- smaller than a player's: there can be dozens on screen
 * at once, and a wave is background context for a fight, not something to pick out one
 * of by its face the way a player is. */
const CREEP_MARKER = 8
function clamp(value: number, low: number, high: number) {
  return Math.min(Math.max(value, low), high)
}

/**
 * Keeps the frame filled by the map.
 *
 * At a given zoom the visible window is `1 / zoom` of the image, so its centre can only
 * travel within half that of either edge before the frame starts showing nothing. At 1x
 * the range collapses to the middle, which is the whole map and the only sensible place
 * for it to be.
 */
function inBounds(centre: { x: number; y: number }, zoom: number) {
  const edge = 0.5 / zoom
  return {
    x: clamp(centre.x, edge, 1 - edge),
    y: clamp(centre.y, edge, 1 - edge),
  }
}

/**
 * The match on the map: where everyone is, over the game's own minimap.
 *
 * Zoom and pan are a transform on a single layer holding the image and the markers, so
 * the two can never drift apart -- a marker is positioned once, in map fractions, and the
 * transform moves picture and player together.
 *
 * Markers are counter-scaled so they stay the same size on screen at any zoom. Zooming in
 * is for reading the ground a fight is happening on, not for magnifying the faces; heads
 * that grew with the map would cover the very detail being zoomed into. The counter-scale
 * is a transform, not a change to the marker's own width and height -- see the comment at
 * the marker below for why that distinction matters past about 5x.
 *
 * Each marker carries a thin health bar above the portrait, from the position stream's
 * own hp/maxHp -- it moves at the stream's 8 Hz, not the scoreboard's 1 Hz, so it reads a
 * burst of damage as it lands rather than a second later.
 *
 * Four layers of context, drawn in the order they matter least to most: the lanes'
 * ziplines, then the creep wave, then objectives -- every structure, plus the Mid-Boss
 * -- and players last, so a player's marker is never buried under any of them. Objectives are the one thing on the map
 * that does not move, drawn with the game minimap's own icons -- see ObjectiveIcon --
 * whose fill is the structure's health.
 *
 * With them, the map's timers: each neutral camp as its tier, filled while up and hollow
 * while down, and the Urn where it lies or over whoever carries it; and a small table of
 * the same in the corner, saying when each comes back -- see MapTimers.
 *
 * Over the top of all that, the moments: deaths and casts, from the replay's event
 * stream rather than its sampled state -- see EventLayer -- a kill feed in the corner
 * saying who killed whom, and a muzzle flash on anyone firing. Each can be switched off,
 * since in a big fight they are the noisiest thing on the map.
 *
 * Clicking a player selects them for the inspector beside the map, and follows them.
 * Panning or zooming lets go of the camera but keeps the selection: looking elsewhere is
 * not the same as being done with someone.
 *
 * Built like a video player's screen: the map fills it, and its controls float over the
 * corners the round city leaves empty -- display toggles top left, kill feed top right,
 * and the transport along the bottom, which fades out while the match plays and comes
 * back when the pointer moves. Anything marked `data-map-chrome` is a control, not map:
 * pressing or scrolling on it neither pans nor zooms.
 *
 * With `players` off, it is the map on its own: no heroes and none of their moments --
 * deaths, casts, shots, the kill feed -- only the timers, structures, camps and troopers,
 * for watching how the map itself runs over a match.
 */
export function MapView({
  timeline,
  at,
  speed,
  selected,
  onSelect,
  playing,
  transport,
  focus = null,
  players = true,
  ghosts = false,
}: {
  timeline: Timeline
  at: number
  /** Playback speed, which sets how long an event stays on screen in match time. */
  speed: number
  /** The player being inspected, as an index into `timeline.players`. */
  selected: number | null
  onSelect: (player: number | null) => void
  /** Whether the match is playing, which lets the transport fade out when idle. */
  playing: boolean
  /** The play controls, pinned along the bottom of the screen. */
  transport: ReactNode
  /** Where to take the camera, as of the latest request; see `MapFocus`. */
  focus?: MapFocus | null
  /** Whether heroes and their moments are drawn; see above. */
  players?: boolean
  /** Whether a crate, statue, snack or powerup that is taken (or not up yet) stays on
   * the map, greyed, rather than disappearing -- for the map timings page, where the
   * spots are the point. */
  ghosts?: boolean
}) {
  const [zoom, setZoom] = useState(1)
  // Where the view sits when nobody is being followed.
  const [panned, setPanned] = useState({ x: 0.5, y: 0.5 })
  // Who the camera was last told to follow. Only honoured while that player is still
  // the one selected: closing the inspector lets go of the camera too.
  const [followRequest, setFollowing] = useState<number | null>(null)
  // A new focus request moves the camera once, during render as React advises for state
  // that follows a prop -- after that, the view is the viewer's to pan and zoom again.
  const [focused, setFocused] = useState(focus)
  if (focus !== focused) {
    setFocused(focus)
    if (focus) {
      const { left, top } = worldToMap(focus.x, focus.y)
      const across = 2 * Math.max(focus.radius, FOCUS_MIN_RADIUS)
      setZoom(clamp((2 * MAP_IMAGE_RADIUS * FOCUS_FILL) / across, MIN_ZOOM, MAX_ZOOM))
      setPanned({ x: left, y: top })
      setFollowing(null)
    }
  }
  const following = followRequest !== null && followRequest === selected ? followRequest : null
  const frameRef = useRef<HTMLDivElement>(null)
  // A press on the map: where the pointer last was, and whether it has moved far enough
  // to be a drag rather than a click.
  const dragging = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  // Whose eyes the map is seen through: neutral, in team colours, or one side's, the way
  // the game's own minimap colours it. See ../map/palette.
  const [viewAs, setViewAs] = useState<ViewAs>('neutral')
  const [showDeaths, setShowDeaths] = useState(true)
  const [showCasts, setShowCasts] = useState(true)
  const [showShots, setShowShots] = useState(true)
  const [showCamps, setShowCamps] = useState(true)
  // Crates and statues each have three settings. Both start at "when zoomed": there
  // are hundreds of spots, which at the whole map's scale bury everything else,
  // but zoomed into a fight they are exactly what is worth seeing.
  const [crateDetail, setCrateDetail] = useState<Detail>('zoomed')
  const [statueDetail, setStatueDetail] = useState<Detail>('zoomed')
  // Healing Snacks are few enough -- 36 -- to show at any zoom.
  const [snackDetail, setSnackDetail] = useState<Detail>('always')
  const [showTimers, setShowTimers] = useState(true)
  const [showPowerups, setShowPowerups] = useState(true)
  const [mapLayer, setMapLayer] = useState<MapLayer>('auto')
  // The frame's width in CSS pixels, which the lane stroke needs to hold its on-screen
  // width. The frame is square, so one number is enough.
  const [framePx, setFramePx] = useState(0)
  // Whether the pointer has rested long enough for the controls to get out of the way.
  // Only ever true while playing: paused, there is nothing to watch past them.
  const [idle, setIdle] = useState(false)
  const idleTimer = useRef(0)
  const wake = () => {
    setIdle(false)
    window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS)
  }
  useEffect(() => () => window.clearTimeout(idleTimer.current), [])
  const chromeHidden = playing && idle
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const observer = new ResizeObserver(([entry]) => setFramePx(entry.contentRect.width))
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  const spots = players ? spotsAt(timeline, at) : []
  // The backgrounds this match's map has: rooms under the middle on both maps, tunnels
  // only on the current one. A place without one is drawn on the streets.
  const belowArt = belowGroundFor(timeline.build)
  const hasTunnels = Object.keys(belowArt).length > 0
  const watched = following ?? selected
  const wanted: Below | null =
    mapLayer === 'auto'
      ? watched !== null
        ? (spots[watched]?.below ?? null)
        : null
      : mapLayer === 'streets'
        ? null
        : mapLayer
  const below: Below | null = wanted && belowArt[wanted] ? wanted : null
  const creeps = creepsAt(timeline, at)
  // One icon per Base Guardian pair, as the game's minimap draws them.
  const objectives = pairBaseGuardians(objectivesAt(timeline, at))
  const lanes = lanesAt(timeline, at)
  const kills = players && showDeaths ? killsAt(timeline, at, lingerFor(DEATH_LINGER, speed)) : []
  const casts = players && showCasts ? castsAt(timeline, at, lingerFor(CAST_LINGER, speed)) : []
  const feed =
    players && showDeaths
      ? killFeed(timeline, at, lingerFor(KILL_FEED_LINGER, speed), KILL_FEED_MAX)
      : []
  const firing = players && showShots ? firingAt(timeline, at, lingerFor(FIRE_TAIL, speed)) : []
  // Each camp's whole history is worked out once per match; its state at the playhead is
  // then a lookup.
  const histories = useMemo(() => campHistories(timeline), [timeline])
  const delays = useMemo(() => respawnDelays(histories), [histories])
  const camps = campsAt(histories, at, delays)
  // Crate and Sinner's Sacrifice spots are fixed for the match, so found once.
  const crateSpots = useMemo(() => breakableSpots(timeline.events.crates), [timeline])
  const sinnerSpots = useMemo(() => breakableSpots(timeline.events.sinners), [timeline])
  const { hz, quant } = timeline.events
  const crates = breakablesAt(timeline.events.crates, crateSpots, hz, quant, at)
  const toughSpots = useMemo(() => breakableSpots(timeline.events.toughCrates ?? EMPTY), [timeline])
  const toughCrates = breakablesAt(timeline.events.toughCrates ?? EMPTY, toughSpots, hz, quant, at)
  const showCrates = shown(crateDetail, zoom)
  const showStatues = shown(statueDetail, zoom)
  const statueSpots = useMemo(() => breakableSpots(timeline.events.statues), [timeline])
  const statues = breakablesAt(timeline.events.statues, statueSpots, hz, quant, at)
  const sinners = breakablesAt(timeline.events.sinners, sinnerSpots, hz, quant, at)
  const showSnacks = shown(snackDetail, zoom)
  const snackSpots = useMemo(() => breakableSpots(timeline.events.snacks), [timeline])
  const snacks = breakablesAt(timeline.events.snacks, snackSpots, hz, quant, at)
  const powerupSpots = useMemo(() => breakableSpots(timeline.events.powerups), [timeline])
  const powerups = powerupsAt(timeline.events.powerups, powerupSpots, hz, quant, at)
  const urn = urnAt(timeline, at)
  const rift = riftAt(timeline, at)
  // A flicker about eight times a second of screen time: the playhead divided by the
  // speed, since at 16x the match clock alone would strobe it faster than a screen can
  // draw. Paused, the playhead holds, and so does the flash.
  const flash = Math.floor((at / Math.max(speed, 1)) * 16) % 2 === 0

  /*
   * The point held at the centre of the frame, in map fractions.
   *
   * While following, it is derived from the player rather than stored: the clock moves
   * many times a second, and writing the camera into state on every one of those would
   * mean a second render per frame to chase a value already known during the first.
   */
  const followed = following === null ? null : spots[following]
  const centre = followed
    ? inBounds((({ left, top }) => ({ x: left, y: top }))(worldToMap(followed.x, followed.y)), zoom)
    : inBounds(panned, zoom)

  // Read by the wheel listener, which is attached once and so cannot close over state.
  // Written after each render rather than during one: a ref is not render output.
  const view = useRef({ zoom, centre })
  useEffect(() => {
    view.current = { zoom, centre }
  })

  /*
   * Zoom about the pointer, so the spot under the cursor stays under it. Without this the
   * map drifts away from whatever you were trying to look at, which at 10x is most of it.
   *
   * A native listener rather than React's `onWheel`, because React registers wheel
   * passively at the root: `preventDefault` there is ignored and the page scrolls away
   * underneath the zoom.
   */
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const onWheel = (event: WheelEvent) => {
      // A control's own scrolling -- the full scoreboard's, say -- is not a zoom.
      if ((event.target as Element).closest('[data-map-chrome]')) return
      event.preventDefault()
      const box = frame.getBoundingClientRect()
      // Where the pointer is within the frame, as a fraction, measured from the centre.
      const offX = (event.clientX - box.left) / box.width - 0.5
      const offY = (event.clientY - box.top) / box.height - 0.5

      const { zoom: was, centre: from } = view.current
      const next = clamp(was * (event.deltaY < 0 ? 1.15 : 1 / 1.15), MIN_ZOOM, MAX_ZOOM)
      const centred = inBounds(
        {
          x: from.x + offX * (1 / was - 1 / next),
          y: from.y + offY * (1 / was - 1 / next),
        },
        next,
      )
      // Written back at once, not left to the post-render effect: a flick of the wheel
      // arrives as a burst of events within one frame, and each has to build on the last
      // rather than all of them reading the zoom the burst started at.
      view.current = { zoom: next, centre: centred }

      setZoom(next)
      setPanned(centred)
      setFollowing(null)
    }

    frame.addEventListener('wheel', onWheel, { passive: false })
    return () => frame.removeEventListener('wheel', onWheel)
  }, [])

  /*
   * The pointer is captured only once a press has moved past DRAG_THRESHOLD, not on the
   * press itself. Capturing on press retargets the release -- and so the click -- to
   * the frame, and a click on a player's portrait never reached the portrait at all.
   */
  const onPointerDown = (event: React.PointerEvent) => {
    if ((event.target as Element).closest('[data-map-chrome]')) return
    dragging.current = { x: event.clientX, y: event.clientY, moved: false }
  }

  const onPointerMove = (event: React.PointerEvent) => {
    wake()
    const from = dragging.current
    const frame = frameRef.current
    if (!from || !frame) return
    if (!from.moved) {
      if (Math.hypot(event.clientX - from.x, event.clientY - from.y) < DRAG_THRESHOLD) return
      from.moved = true
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    const box = frame.getBoundingClientRect()
    const dx = (event.clientX - from.x) / box.width / zoom
    const dy = (event.clientY - from.y) / box.height / zoom
    dragging.current = { x: event.clientX, y: event.clientY, moved: true }
    setPanned(inBounds({ x: centre.x - dx, y: centre.y - dy }, zoom))
    setFollowing(null)
  }

  const onPointerUp = (event: React.PointerEvent) => {
    dragging.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const reset = () => {
    setZoom(1)
    setPanned({ x: 0.5, y: 0.5 })
    setFollowing(null)
  }

  // Translating by the distance from the frame's centre to the held point, in percent of
  // the layer, puts that point in the middle at any zoom.
  const shiftX = (0.5 - centre.x) * 100
  const shiftY = (0.5 - centre.y) * 100

  const chromeClass = `transition-opacity duration-300 motion-reduce:transition-none ${
    chromeHidden ? 'pointer-events-none opacity-0' : 'opacity-100'
  }`

  return (
    <div
      ref={frameRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => playing && setIdle(true)}
      onFocus={() => setIdle(false)}
      className={`ui-screen relative aspect-square w-full touch-none overflow-hidden ${
        chromeHidden ? 'cursor-none' : 'cursor-grab active:cursor-grabbing'
      }`}
    >
      <div
        className="absolute inset-0 origin-center"
        style={{ transform: `scale(${zoom}) translate(${shiftX}%, ${shiftY}%)` }}
      >
        <img
          src={minimapFor(timeline.build)}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full transition-opacity duration-150 select-none"
          style={{ opacity: below ? STREETS_UNDER : 1 }}
        />
        {below && (
          <img
            src={belowArt[below]}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full select-none"
          />
        )}

        {/* Straight over the picture and under everything else, as in the game. */}
        <ZiplineLayer lanes={lanes} viewAs={viewAs} zoom={zoom} framePx={framePx} />

        {/*
            Drawn before the players, so a player marker always sits on top of the wave
            around them rather than being buried in it. Plain filled dots, not portraits:
            there can be several dozen on screen in a big fight, and a face is worth
            drawing only for the twelve people actually being watched.
          */}
        {creeps.map((creep) => {
          const { left, top } = worldToMap(creep.x, creep.y)
          const amber = creep.team === AMBER
          return (
            <div
              // The life's own stable index, not the position in this filtered
              // array -- see the note on CreepSpot.id. Using the array position here
              // was the actual bug behind a dead creep's marker appearing to linger:
              // React reuses a DOM node across renders for whatever unrelated life
              // next lands on the same index, patching its position in place instead
              // of unmounting it, which reads as the old marker sliding to a new spot
              // rather than disappearing.
              key={creep.id}
              aria-hidden="true"
              className="pointer-events-none absolute rounded-full"
              style={{
                left: `${left * 100}%`,
                top: `${top * 100}%`,
                // Same reasoning as a player marker: laid out at full size and
                // counter-scaled by transform, never shrunk directly, so a wave of
                // these stays round instead of going oval under the map's own zoom.
                width: CREEP_MARKER,
                height: CREEP_MARKER,
                transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                background: amber ? 'var(--data-team-amber)' : 'var(--data-team-sapphire)',
                boxShadow: '0 0 0 1px var(--data-marker-shadow)',
                // A little translucent, so overlapping troopers in a clump do not
                // turn into one flat mass of colour.
                opacity: 0.7,
              }}
            />
          )
        })}

        {/*
            Between the creep wave and the players: a landmark, more permanent than
            either, but never the thing being watched the way a player is. `objectives`
            is the same fixed entries every render -- nothing is ever filtered in or out
            of it the way creeps are -- so a plain array index is a stable key here,
            unlike the one creeps needed fixing.
          */}
        {/*
            Neutral camps with the game minimap's own markers, filled while up and hollow
            while down; the Urn where it lies; and, while it is carried, where it is going.
            Landmarks like the structures, so drawn with them, under the players.
          */}
        {/* Standing crates only: a broken one is not a place worth marking. Drawn
              first, as the smallest and least of the landmarks. */}
        {showCrates &&
          crates.map((crate) => {
            if (!crate.standing && !ghosts) return null
            const { left, top } = worldToMap(crate.x, crate.y)
            return (
              <div
                key={`crate-${crate.id}`}
                className="pointer-events-none absolute"
                style={{
                  left: `${left * 100}%`,
                  top: `${top * 100}%`,
                  transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                  ...(crate.standing ? null : GHOST),
                }}
              >
                <CrateGlyph size={6} />
              </div>
            )
          })}
        {showCrates &&
          toughCrates.map((crate) => {
            if (!crate.standing && !ghosts) return null
            const { left, top } = worldToMap(crate.x, crate.y)
            return (
              <div
                key={`tough-${crate.id}`}
                className="pointer-events-none absolute"
                style={{
                  left: `${left * 100}%`,
                  top: `${top * 100}%`,
                  transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                  ...(crate.standing ? null : GHOST),
                }}
              >
                <CrateGlyph size={8} tough />
              </div>
            )
          })}
        {/* Standing Golden Statues, like crates: a broken one is not marked. */}
        {showStatues &&
          statues.map((statue) => {
          if (!statue.standing && !ghosts) return null
          const { left, top } = worldToMap(statue.x, statue.y)
          return (
            <div
              key={`statue-${statue.id}`}
              className="pointer-events-none absolute"
              title="Golden statue"
              style={{
                left: `${left * 100}%`,
                top: `${top * 100}%`,
                transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                ...(statue.standing ? null : GHOST),
              }}
            >
              <StatueGlyph size={12} />
            </div>
          )
        })}
        {/*
            The underground shops (neutral, one each side of the middle), as the game's
            own minimap shop icon. Below the streets, so dimmed unless the underground
            layer is up -- the same way a hero below ground is drawn.
          */}
        {(timeline.shops?.team ?? []).map((team, i) => {
          if (team !== NEUTRAL_TEAM) return null
          const { shops } = timeline
          const { left, top } = worldToMap(shops.x[i] * quant, shops.y[i] * quant)
          return (
            <img
              key={`shop-${i}`}
              src={shopIcon}
              alt=""
              title="Underground shop"
              draggable={false}
              className="pointer-events-auto absolute select-none"
              style={{
                left: `${left * 100}%`,
                top: `${top * 100}%`,
                width: 18,
                height: 18,
                transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                filter: 'drop-shadow(0 0 2px black)',
                opacity: below === 'underground' ? 1 : 0.55,
              }}
            />
          )
        })}
        {/* Powerups there to take, each as the game's icon for its kind. */}
        {showPowerups &&
          powerups.map((powerup) => {
            if (!powerup.kind && !ghosts) return null
            const kind = powerup.kind ?? 'random'
            const { left, top } = worldToMap(powerup.x, powerup.y)
            return (
              <div
                key={`powerup-${powerup.id}`}
                className="pointer-events-none absolute"
                title={powerup.kind ? `${POWERUP_NAMES[kind]} powerup` : 'Powerup spot'}
                style={{
                  left: `${left * 100}%`,
                  top: `${top * 100}%`,
                  transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                  ...(powerup.kind ? null : GHOST),
                }}
              >
                <PowerupGlyph kind={kind} size={16} />
              </div>
            )
          })}
        {/* Healing Snacks there to eat; an eaten one is not marked, like a crate. */}
        {showSnacks &&
          snacks.map((snack) => {
            if (!snack.standing && !ghosts) return null
            const { left, top } = worldToMap(snack.x, snack.y)
            return (
              <div
                key={`snack-${snack.id}`}
                className="pointer-events-none absolute"
                title="Healing snack"
                style={{
                  left: `${left * 100}%`,
                  top: `${top * 100}%`,
                  transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                  ...(snack.standing ? null : GHOST),
                }}
              >
                <SnackGlyph size={10} />
              </div>
            )
          })}
        {showCamps &&
          sinners.map((sinner) => {
            const { left, top } = worldToMap(sinner.x, sinner.y)
            return (
              <div
                key={`sinner-${sinner.id}`}
                className="pointer-events-none absolute"
                title={`Sinner's Sacrifice: ${sinner.standing ? 'up' : 'down'}`}
                style={{
                  left: `${left * 100}%`,
                  top: `${top * 100}%`,
                  transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                  opacity: sinner.standing ? 1 : 0.75,
                }}
              >
                <SinnerGlyph up={sinner.standing} size={13} />
              </div>
            )
          })}
        {showCamps &&
          camps.map((camp) => {
            const { left, top } = worldToMap(camp.x, camp.y)
            return (
              <div
                key={`camp-${camp.id}`}
                className="pointer-events-none absolute"
                title={`${camp.name}, tier ${camp.tier}: ${camp.up ? 'up' : 'down'}`}
                style={{
                  left: `${left * 100}%`,
                  top: `${top * 100}%`,
                  transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                  opacity: camp.up ? 1 : 0.75,
                }}
              >
                <CampGlyph
                  tier={camp.tier}
                  up={camp.up}
                  size={camp.tier === 1 ? 11 : camp.tier === 2 ? 14 : 17}
                />
              </div>
            )
          })}
        {showCamps && urn.state === 'onMap' && (
          <div
            className="pointer-events-none absolute"
            style={{
              left: `${worldToMap(urn.x, urn.y).left * 100}%`,
              top: `${worldToMap(urn.x, urn.y).top * 100}%`,
              transform: `translate(-50%, -50%) scale(${1 / zoom})`,
            }}
          >
            <UrnGlyph size={22} />
          </div>
        )}
        {showCamps && urn.state === 'carried' && urn.destination && (
          <div
            className="pointer-events-none absolute"
            title="Urn drop-off"
            style={{
              left: `${worldToMap(urn.destination.x, urn.destination.y).left * 100}%`,
              top: `${worldToMap(urn.destination.x, urn.destination.y).top * 100}%`,
              transform: `translate(-50%, -50%) scale(${1 / zoom})`,
            }}
          >
            {/* The game draws the drop-off in its "team" colours for the side carrying
                the Urn and its "enemy" ones for the side that has to stop them -- so seen
                as a team, it is whichever that team is; seen neutrally, the carrier's. */}
            <DropoffGlyph
              enemy={viewAs !== 'neutral' && timeline.players[urn.player]?.team !== viewAs}
              size={26}
            />
          </div>
        )}

        {/* The Unstable Rift, from its warning until it is taken: faint and pulsing while
            announced, then its 20 m capture circle at the map's own scale, brighter once
            someone is standing in it. */}
        {rift.state === 'open' && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute rounded-full border"
            style={{
              left: `${worldToMap(rift.x, rift.y).left * 100}%`,
              top: `${worldToMap(rift.x, rift.y).top * 100}%`,
              // A share of the map layer, which is square, so it zooms with the map.
              width: `${(RIFT_RADIUS / MAP_IMAGE_RADIUS) * 100}%`,
              aspectRatio: '1',
              transform: 'translate(-50%, -50%)',
              borderColor: 'var(--data-rift)',
              background: `color-mix(in srgb, var(--data-rift) ${rift.contested ? 28 : 14}%, transparent)`,
            }}
          />
        )}
        {(rift.state === 'announced' || rift.state === 'open') && (
          <div
            className={`pointer-events-none absolute ${
              rift.state === 'announced' ? 'motion-safe:animate-pulse' : ''
            }`}
            title="Unstable Rift"
            style={{
              left: `${worldToMap(rift.x, rift.y).left * 100}%`,
              top: `${worldToMap(rift.x, rift.y).top * 100}%`,
              transform: `translate(-50%, -50%) scale(${1 / zoom})`,
            }}
          >
            <RiftGlyph size={22} faded={rift.state === 'announced'} />
          </div>
        )}

        {objectives.map((objective, i) => {
          const { left, top } = worldToMap(objective.x, objective.y)
          return (
            <ObjectiveIcon
              key={i}
              kind={objective.kind}
              team={objective.team}
              colours={objectiveColours(objective, viewAs)}
              hpFraction={objective.hpFraction}
              destroyed={objective.destroyed}
              recentlyDamaged={objective.recentlyDamaged}
              left={left}
              top={top}
              zoom={zoom}
            />
          )
        })}

        {/*
            Where each player is looking: a cone out from their centre, fading with
            distance. A layer of its own under every portrait rather than part of each
            marker, so one player's cone never washes over another's face. Placed and
            counter-scaled exactly as the markers below are. The world turns
            counter-clockwise from east and CSS clockwise from the right, with the map's
            y flipped between them, so the one conversion is a sign.
          */}
        {spots.map((spot, i) => {
          if (!spot.alive) return null
          const player = timeline.players[i]
          const { left, top } = worldToMap(spot.x, spot.y)
          const colour =
            player.team === AMBER ? 'var(--data-team-amber)' : 'var(--data-team-sapphire)'
          return (
            <div
              key={player.slot}
              aria-hidden="true"
              className="pointer-events-none absolute"
              style={{
                left: `${left * 100}%`,
                top: `${top * 100}%`,
                width: 0,
                height: 0,
                transform: `scale(${1 / zoom}) rotate(${-spot.yaw}deg)`,
              }}
            >
              {/* Sized to the cone's reach and centred on the player: an <svg> of zero
                    size is not drawn at all, overflow or not. */}
              <svg
                className="absolute"
                width={CONE_REACH * 2}
                height={CONE_REACH * 2}
                viewBox={`${-CONE_REACH} ${-CONE_REACH} ${CONE_REACH * 2} ${CONE_REACH * 2}`}
                style={{ left: -CONE_REACH, top: -CONE_REACH }}
              >
                <defs>
                  {/* Keyed by lobby slot: one map on the page, so unique. Colours go
                        through `style`: a stop's presentation attribute does not resolve
                        CSS variables, and the team colours are variables. */}
                  <radialGradient
                    id={`view-cone-${player.slot}`}
                    cx={0}
                    cy={0}
                    r={CONE_REACH}
                    gradientUnits="userSpaceOnUse"
                  >
                    {/* Strongest right at the ring, where it leaves the portrait. */}
                    <stop
                      offset={MARKER / 2 / CONE_REACH}
                      style={{ stopColor: colour, stopOpacity: 0.55 }}
                    />
                    <stop offset="1" style={{ stopColor: colour, stopOpacity: 0 }} />
                  </radialGradient>
                </defs>
                <path d={CONE_PATH} fill={`url(#view-cone-${player.slot})`} />
              </svg>
            </div>
          )
        })}

        {spots.map((spot, i) => {
          const player = timeline.players[i]
          const { left, top } = worldToMap(spot.x, spot.y)
          const icon = heroIcon(player.heroId)
          const teamColour =
            player.team === AMBER ? 'var(--data-team-amber)' : 'var(--data-team-sapphire)'
          return (
            <button
              key={player.slot}
              type="button"
              onClick={() => {
                const next = selected === i ? null : i
                onSelect(next)
                setFollowing(next)
              }}
              title={`${player.name}${spot.below ? ` (${spot.below === 'underground' ? 'underground' : 'in a tunnel'})` : ''} — click to inspect`}
              className="absolute"
              style={{
                left: `${left * 100}%`,
                top: `${top * 100}%`,
                // Always laid out at full size, never shrunk: a box a few CSS pixels
                // wide has to be rasterised -- border, radius and all -- before the
                // ancestor's scale magnifies it, and that rounds to whole device
                // pixels unevenly enough to wobble between frames and go visibly oval.
                // The counter-scale below cancels the ancestor's zoom as pure
                // compositor math instead, so the marker is always painted at one
                // stable size and border widths stay real widths at any zoom.
                width: MARKER,
                height: MARKER,
                transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                // A dead player still marks where they fell; the bar over their head
                // does not, so it is the one thing that disappears rather than dims.
                opacity: spot.alive ? 1 : 0.5,
              }}
            >
              {spot.alive && (
                <div
                  aria-hidden="true"
                  // Positioned against the portrait below rather than sized into the
                  // button's own box, so it never perturbs the centring math above --
                  // that translate(-50%,-50%) is measured against MARKER x MARKER, and
                  // has to stay that way for the marker to sit on the right point.
                  className="bg-ui-inset/80 absolute bottom-full left-0 mb-0.5 h-[3px] w-full overflow-hidden rounded-full"
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${spot.hpFraction * 100}%`,
                      // The one continuous ramp in the codebase: everywhere else
                      // color-mix blends a token toward a neutral, this blends two
                      // meaningful endpoints, green at full to red empty.
                      background: `color-mix(in srgb, var(--data-health) ${Math.round(spot.hpFraction * 100)}%, var(--data-damage))`,
                    }}
                  />
                </div>
              )}
              <span
                className="relative block h-full w-full overflow-hidden rounded-full border-2 bg-ui-bg"
                style={{
                  borderColor: teamColour,
                  // Underground: the ring breaks up and the face sinks back, so a hero
                  // in a tunnel never reads as standing in the street drawn over them.
                  borderStyle: spot.below ? 'dashed' : 'solid',
                  boxShadow: selected === i ? '0 0 0 2px var(--ui-accent)' : undefined,
                }}
              >
                {icon ? (
                  <img
                    src={icon}
                    alt={player.name}
                    draggable={false}
                    className="h-full w-full object-cover"
                    style={spot.below ? { opacity: 0.55 } : undefined}
                  />
                ) : (
                  <span className="sr-only">{player.name}</span>
                )}
              </span>
            </button>
          )
        })}

        {/*
            A muzzle flash just past a portrait's rim, in the direction they are looking
            -- where the gun points. Bright and small, so a fight reads as who is shooting
            without a line per bullet across the map. Over the portraits rather than with
            the cones beneath them: in a fight, where it matters, the portraits bunch up
            and a flash under them is a flash under a neighbour's face.
          */}
        {spots.map((spot, i) => {
          if (!firing[i] || !spot.alive) return null
          const { left, top } = worldToMap(spot.x, spot.y)
          return (
            <svg
              key={timeline.players[i].slot}
              aria-hidden="true"
              className="pointer-events-none absolute overflow-visible"
              width={1}
              height={1}
              viewBox="0 0 1 1"
              style={{
                left: `${left * 100}%`,
                top: `${top * 100}%`,
                transform: `scale(${1 / zoom}) rotate(${-spot.yaw}deg)`,
                transformOrigin: '0 0',
              }}
            >
              <path
                d={MUZZLE_PATH}
                style={{
                  fill: flash ? 'var(--data-shot-hot)' : 'var(--data-shot)',
                  opacity: flash ? 1 : 0.75,
                  filter: 'drop-shadow(0 0 1.5px var(--data-marker-shadow))',
                }}
              />
            </svg>
          )
        })}

        {showCamps &&
          urn.state === 'carried' &&
          spots[urn.player] &&
          (() => {
            const { left, top } = worldToMap(spots[urn.player].x, spots[urn.player].y)
            return (
              <div
                className="pointer-events-none absolute"
                title="Carrying the Urn"
                style={{
                  left: `${left * 100}%`,
                  top: `${top * 100}%`,
                  width: 0,
                  height: 0,
                  transform: `scale(${1 / zoom})`,
                }}
              >
                <span className="absolute" style={{ left: MARKER / 2 - 5, top: -MARKER / 2 - 8 }}>
                  <UrnGlyph size={18} />
                </span>
              </div>
            )
          })()}

        {/* Over the portraits: a mark on a fallen hero, an icon beside a caster. */}
        <EventMarks
          kills={kills}
          casts={casts}
          spots={spots}
          players={timeline.players}
          speed={speed}
          zoom={zoom}
        />
      </div>

      {/* Outside the zoomed layer: it belongs to the screen, not to a place on the map. */}
      <KillFeed kills={feed} players={timeline.players} speed={speed} />

      <div
        data-map-chrome
        className="absolute top-2 left-2 flex max-w-[calc(100%-7rem)] flex-col items-start gap-1.5"
      >
        {/* Only the controls step aside while the match plays; the timers are data. */}
        <div className={`flex flex-wrap items-center gap-1.5 ${chromeClass}`}>
          <ToggleGroup label="Show on map">
            {(
              [
                ...(players
                  ? ([
                      ['Deaths', showDeaths, setShowDeaths],
                      ['Casts', showCasts, setShowCasts],
                      ['Shots', showShots, setShowShots],
                    ] as const)
                  : []),
                ['Camps', showCamps, setShowCamps],
                ['Powerups', showPowerups, setShowPowerups],
                ['Timers', showTimers, setShowTimers],
              ] as const
            ).map(([label, on, set]) => (
              <Toggle key={label} on={on} onClick={() => set(!on)}>
                {label}
              </Toggle>
            ))}
          </ToggleGroup>
          <DetailSelect label="Crates" value={crateDetail} onChange={setCrateDetail} />
          <DetailSelect label="Statues" value={statueDetail} onChange={setStatueDetail} />
          {hasTunnels && (
            <label className="bg-ui-surface/95 border-ui-line rounded-ui flex items-center gap-1.5 border py-0.5 pr-1 pl-2 text-[0.75rem]">
              <span className="text-ui-muted">Map</span>
              <select
                value={mapLayer}
                onChange={(event) => setMapLayer(event.target.value as MapLayer)}
                className="bg-ui-surface text-ui-fg rounded-[4px] px-1 py-0.5"
              >
                {MAP_LAYERS.filter(
                  ([value]) => value === 'auto' || value === 'streets' || belowArt[value],
                ).map(([value, label]) => (
                  <option key={value} value={value}>
                    {value === 'auto' && below ? `Auto (${below})` : label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {snackSpots.length > 0 && (
            <DetailSelect label="Snacks" value={snackDetail} onChange={setSnackDetail} />
          )}
          <ToggleGroup label="View map as">
            {(
              [
                ['neutral', 'Neutral', undefined],
                [AMBER, TEAM_SHORT_NAMES[AMBER], 'var(--data-team-amber)'],
                [SAPPHIRE, TEAM_SHORT_NAMES[SAPPHIRE], 'var(--data-team-sapphire)'],
              ] as const
            ).map(([team, label, dot]) => (
              <Toggle key={team} on={viewAs === team} dot={dot} onClick={() => setViewAs(team)}>
                {label}
              </Toggle>
            ))}
          </ToggleGroup>
          {(zoom > 1 || following !== null) && (
            <ToggleGroup label="Camera">
              <span className="text-ui-muted px-1.5 text-[0.75rem]">
                {following !== null
                  ? `Following ${timeline.players[following].name}`
                  : `${zoom.toFixed(1)}×`}
              </span>
              <Toggle on={false} onClick={reset}>
                Reset view
              </Toggle>
            </ToggleGroup>
          )}
        </div>
        {showTimers && (
          <MapTimers
            timeline={timeline}
            at={at}
            camps={camps}
            sinners={sinners}
            crates={crates}
            statues={statues}
            snacks={snacks}
            powerups={powerups}
            toughCrates={toughCrates}
          />
        )}
      </div>

      <div data-map-chrome className={`absolute inset-x-0 bottom-0 ${chromeClass}`}>
        {transport}
      </div>
    </div>
  )
}

/** A small group of controls over the map, on a plate solid enough to read anywhere. */
function ToggleGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="bg-ui-surface/95 border-ui-line flex items-center gap-0.5 rounded-ui border p-0.5"
    >
      {children}
    </div>
  )
}

/**
 * One option. Selected is the application's own state -- a raised fill -- never a data
 * colour; an option that names a team says so with a dot of that team's colour.
 */
function Toggle({
  on,
  dot,
  onClick,
  children,
}: {
  on: boolean
  /** A data colour to mark the option with, for an option that names a team. */
  dot?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-[4px] px-2 py-1 text-[0.75rem] leading-none transition-colors ${
        on ? 'bg-ui-raised text-ui-fg' : 'text-ui-muted hover:text-ui-fg'
      }`}
    >
      {dot && (
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
      )}
      {children}
    </button>
  )
}

/** One of the three-way detail settings, as a compact labelled select on a plate like
 * the toggle groups beside it. */
function DetailSelect({
  label,
  value,
  onChange,
}: {
  label: string
  value: Detail
  onChange: (value: Detail) => void
}) {
  return (
    <label className="bg-ui-surface/95 border-ui-line rounded-ui flex items-center gap-1.5 border py-0.5 pr-1 pl-2 text-[0.75rem]">
      <span className="text-ui-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as Detail)}
        className="bg-ui-surface text-ui-fg rounded-[4px] px-1 py-0.5"
      >
        <option value="always">Always</option>
        <option value="zoomed">When zoomed</option>
        <option value="hidden">Hidden</option>
      </select>
    </label>
  )
}
