/**
 * Floating-surface behaviour: anchored popovers, modal dialogs, and the toast
 * stack. Geometry comes from `anchor.ts`; every surface carries the entrance /
 * exit animation, focus contract and Escape/outside-click handling here so the
 * feature components stay presentational.
 * @module @alexpeng/dsh-custom-plugin/client/ui/overlays
 */

import * as React from 'react'
import { anchorFrame, type AnchorFrame, type AnchorRect } from './anchor.ts'
import { cx } from './primitives.tsx'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const EXIT_MS = 160
const TOAST_EXIT_MS = 160

function matchReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Whether the user asked the platform for reduced motion. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(matchReducedMotion)
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (): void => setReduced(mq.matches)
    mq.addEventListener?.('change', onChange)
    setReduced(mq.matches)
    return () => { mq.removeEventListener?.('change', onChange) }
  }, [])
  return reduced
}

/**
 * Keep a surface mounted through its exit animation. `state` is written to
 * `data-state` so CSS can run the matching keyframes.
 */
export function usePresence(open: boolean, exitMs = EXIT_MS): { mounted: boolean; state: 'open' | 'closed' } {
  const reduced = useReducedMotion()
  const [mounted, setMounted] = React.useState(open)
  const [state, setState] = React.useState<'open' | 'closed'>(open ? 'open' : 'closed')
  React.useEffect(() => {
    if (open) {
      // Mount and mark open in the same commit so the entry animation runs on
      // insertion; a deferred 'open' would paint one frame of the exit state.
      setMounted(true)
      setState('open')
      return
    }
    setState('closed')
    const timer = setTimeout(() => setMounted(false), reduced ? 0 : exitMs)
    return () => clearTimeout(timer)
  }, [open, exitMs, reduced])
  return { mounted, state }
}

function rectOf(rect: DOMRect): AnchorRect {
  return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height }
}

function firstFocusable(node: HTMLElement): HTMLElement | null {
  const preferred = node.querySelector<HTMLElement>('[data-autofocus]')
  if (preferred !== null) return preferred
  const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0)
  return items[0] ?? null
}

export interface PopoverProps {
  open: boolean
  anchor: React.RefObject<HTMLElement | null>
  onClose: () => void
  children?: React.ReactNode
  ariaLabel: string
  width?: number
  maxHeight?: number
  className?: string
  align?: 'start' | 'end' | 'center'
  gap?: number
  margin?: number
  initialFocus?: 'first' | 'none'
}

/**
 * Non-modal anchored popover: opens on the trigger, flips when the viewport
 * runs out of room, closes on Escape or an outside pointer press, and returns
 * focus to the trigger it opened from.
 */
export function Popover(props: PopoverProps): React.ReactElement | null {
  const { open, anchor, onClose, ariaLabel, width = 380, maxHeight = 560, className, align = 'start', gap = 8, margin = 8, initialFocus = 'first' } = props
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [frame, setFrame] = React.useState<AnchorFrame | null>(null)
  const { mounted, state } = usePresence(open)
  const onCloseRef = React.useRef(onClose)
  onCloseRef.current = onClose
  const openerRef = React.useRef<HTMLElement | null>(null)

  React.useLayoutEffect(() => {
    if (!mounted) return
    const measure = (): void => {
      const node = panelRef.current
      const height = Math.min(node?.scrollHeight ?? maxHeight, maxHeight)
      const trigger = anchor.current
      const viewport = {
        width: typeof window === 'undefined' ? 1280 : window.innerWidth,
        height: typeof window === 'undefined' ? 800 : window.innerHeight,
      }
      if (trigger === null) {
        setFrame({
          left: Math.max(margin, Math.round((viewport.width - width) / 2)),
          top: 72,
          maxHeight: viewport.height - 144,
          placement: 'bottom',
          origin: 'center top',
        })
        return
      }
      setFrame(anchorFrame(rectOf(trigger.getBoundingClientRect()), { width, height }, viewport, { align, gap, margin }))
    }
    measure()
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(measure) : 0
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [mounted, anchor, width, maxHeight, align, gap, margin])

  // Focus contract: remember the opener, move focus in, restore it on close —
  // but never steal focus from a surface the user moved to deliberately.
  React.useEffect(() => {
    if (!open) return
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : anchor.current
    const node = panelRef.current
    if (initialFocus === 'first' && node !== null) {
      const target = firstFocusable(node) ?? node
      try { target.focus({ preventScroll: true }) } catch { /* focus rejected */ }
    }
    return () => {
      const opener = openerRef.current
      if (opener === null || !opener.isConnected) return
      const active = document.activeElement
      const activeIsOurs = active === null || active === document.body || active === document.documentElement
        || (node !== null && node.contains(active) === true)
      if (!activeIsOurs) return
      try { opener.focus({ preventScroll: true }) } catch { /* opener gone */ }
    }
  }, [open, initialFocus, anchor])

  React.useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      onCloseRef.current()
    }
    const onDown = (event: MouseEvent): void => {
      const target = event.target instanceof Node ? event.target : null
      if (target === null) return
      if (panelRef.current?.contains(target) === true) return
      if (anchor.current?.contains(target) === true) return
      // A modal opened from this popover (folder prompts, confirmations) is a
      // separate decision surface: pressing inside it must not dismiss the
      // popover underneath.
      const el = target instanceof Element ? target : null
      if (el !== null && el.closest('.vx-dialog-mask') !== null) return
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown, true)
    }
  }, [open, anchor])

  if (!mounted) return null
  return React.createElement('div', {
    ref: panelRef,
    className: cx('vx-popover', props.className),
    'data-state': state,
    role: 'dialog',
    'aria-modal': 'false',
    'aria-label': ariaLabel,
    tabIndex: -1,
    style: {
      left: frame?.left ?? -9999,
      top: frame?.top ?? -9999,
      width,
      maxHeight,
      transformOrigin: frame?.origin ?? 'left top',
      maxWidth: frame === null ? undefined : `calc(100vw - ${margin * 2}px)`,
      visibility: frame === null ? 'hidden' : undefined,
      // Enter from the trigger's side: a card below its button starts a few
      // pixels high (toward the button), one above starts low.
      '--vx-pop-shift': frame === null ? '6px' : frame.placement === 'bottom' ? '-6px' : '6px',
    } as React.CSSProperties,
  }, props.children)
}

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: React.ReactNode
  footer?: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
  dismissible?: boolean
  className?: string
}

/** Modal dialog: focus trap, Escape / mask close, entrance and exit motion. */
export function Dialog(props: DialogProps): React.ReactElement | null {
  const { open, onClose, title, description, children, footer, size = 'md', dismissible = true } = props
  const { mounted, state } = usePresence(open, 160)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const titleId = React.useId()
  const descId = React.useId()
  const onCloseRef = React.useRef(onClose)
  onCloseRef.current = onClose

  React.useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const node = panelRef.current
    if (node !== null) {
      const target = firstFocusable(node) ?? node
      try { target.focus({ preventScroll: true }) } catch { /* focus rejected */ }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (!dismissible) return
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || node === null) return
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0)
      if (items.length === 0) { event.preventDefault(); node.focus(); return }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || active === node)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      if (previous !== null && previous.isConnected) {
        try { previous.focus({ preventScroll: true }) } catch { /* opener gone */ }
      }
    }
  }, [open, dismissible])

  if (!mounted) return null
  return React.createElement('div', {
    className: 'vx-dialog-mask',
    'data-state': state,
    onMouseDown: (event: React.MouseEvent) => {
      if (dismissible && event.target === event.currentTarget) onCloseRef.current()
    },
  },
    React.createElement('div', {
      ref: panelRef,
      className: cx('vx-dialog', `vx-dialog-${size}`, props.className),
      'data-state': state,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      'aria-describedby': description === undefined ? undefined : descId,
      tabIndex: -1,
    },
      React.createElement('div', { className: 'vx-dialog-head' },
        React.createElement('div', { className: 'vx-dialog-titles' },
          React.createElement('h2', { className: 'vx-dialog-title', id: titleId }, title),
          description === undefined ? null : React.createElement('p', { className: 'vx-dialog-desc', id: descId }, description),
        ),
        dismissible
          ? React.createElement('button', { type: 'button', className: 'vx-icon-button vx-icon-button-sm', 'aria-label': '关闭', title: '关闭', onClick: () => onCloseRef.current() }, '×')
          : null,
      ),
      React.createElement('div', { className: 'vx-dialog-body' }, children),
      footer === undefined ? null : React.createElement('div', { className: 'vx-dialog-footer' }, footer),
    ),
  )
}

export interface ToastItem {
  id: number
  text: string
  kind: string
  action: { label: string; run: () => void } | null
}

function ToastRow(props: { item: ToastItem; leaving: boolean; fresh: boolean; onDismiss: (id: number) => void }): React.ReactElement {
  const { item, leaving, fresh, onDismiss } = props
  const [paused, setPaused] = React.useState(false)
  React.useEffect(() => {
    if (paused) return
    // Actionable toasts (the prompt-delete undo) keep a 5s window so the
    // documented undo period matches the shipped timer.
    const ms = item.action !== null ? 5000 : (item.kind === 'error' ? 6000 : 3800)
    const timer = setTimeout(() => onDismiss(item.id), ms)
    return () => clearTimeout(timer)
  }, [paused, item.id, item.kind, item.action, onDismiss])
  return React.createElement('div', {
    className: cx('vx-toast', item.kind === 'error' ? 'vx-toast-error' : ''),
    'data-state': leaving ? 'closed' : fresh ? 'open' : 'settled',
    role: 'status',
    onMouseEnter: () => setPaused(true),
    onMouseLeave: () => setPaused(false),
  },
    React.createElement('span', { className: 'vx-toast-text' }, item.text),
    item.action === null ? null : React.createElement('button', {
      type: 'button',
      className: 'vx-toast-action',
      onClick: () => {
        try { item.action?.run() } catch { /* action failed */ }
        // A one-shot action (the prompt-delete undo) must not run twice from
        // the same toast.
        onDismiss(item.id)
      },
    }, item.action.label),
    React.createElement('button', {
      type: 'button',
      className: 'vx-toast-close',
      'aria-label': '关闭通知',
      title: '关闭通知',
      onClick: () => onDismiss(item.id),
    }, '×'),
  )
}

/** Toast stack using the host's toast material and tokens. Dismissed rows stay
 *  mounted for their exit animation, in place, so the stack does not jump. */
export function ToastStack(props: { items: readonly ToastItem[]; onDismiss: (id: number) => void }): React.ReactElement {
  // Rows present at mount are already settled: the settings page swaps the
  // stack owner, and a toast that survived the swap must not replay its
  // entrance. Only rows added after mount are "fresh".
  const [rows, setRows] = React.useState<Array<{ item: ToastItem; leaving: boolean; fresh: boolean }>>(
    () => props.items.map((item) => ({ item, leaving: false, fresh: false })),
  )
  const timers = React.useRef(new Map<number, ReturnType<typeof setTimeout>>())
  React.useEffect(() => {
    setRows((current) => {
      const incoming = new Map(props.items.map((item) => [item.id, item]))
      const next = current.map((row) => {
        const item = incoming.get(row.item.id)
        if (item !== undefined) {
          const timer = timers.current.get(item.id)
          if (timer !== undefined) { clearTimeout(timer); timers.current.delete(item.id) }
          return { item, leaving: false, fresh: row.fresh }
        }
        if (!row.leaving) {
          const timer = setTimeout(() => {
            timers.current.delete(row.item.id)
            setRows((live) => live.filter((entry) => entry.item.id !== row.item.id))
          }, TOAST_EXIT_MS)
          timers.current.set(row.item.id, timer)
        }
        return { item: row.item, leaving: true, fresh: row.fresh }
      })
      const known = new Set(next.map((row) => row.item.id))
      for (const item of props.items) {
        if (!known.has(item.id)) next.push({ item, leaving: false, fresh: true })
      }
      return next
    })
  }, [props.items])
  React.useEffect(() => () => {
    for (const timer of timers.current.values()) clearTimeout(timer)
    timers.current.clear()
  }, [])
  return React.createElement('div', { className: 'vx-toast-stack', 'aria-live': 'polite', 'aria-atomic': 'false' },
    rows.map((row) => React.createElement(ToastRow, {
      key: row.item.id,
      item: row.item,
      leaving: row.leaving,
      fresh: row.fresh,
      onDismiss: props.onDismiss,
    })),
  )
}
