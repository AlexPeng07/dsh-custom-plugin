/**
 * Presentational primitives shared by the native-feeling surfaces.
 *
 * Every visual value comes from the host's `--dsw-*` / `--ds-*` tokens (see
 * styles.ts); these components only own structure, state and a11y semantics.
 * @module @alexpeng/dsh-custom-plugin/client/ui/primitives
 */

import * as React from 'react'

/** Join class names, dropping falsy entries. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ')
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  icon?: React.ReactNode
  children?: React.ReactNode
}

/** Text button in the host's control language. */
export function Button(props: ButtonProps): React.ReactElement {
  const { variant = 'secondary', size = 'md', block = false, icon, children, className, type, ...rest } = props
  return React.createElement('button', {
    ...rest,
    type: type ?? 'button',
    className: cx('vx-button', `vx-button-${variant}`, size === 'sm' ? 'vx-button-sm' : '', block ? 'vx-button-block' : '', className),
  }, icon ?? null, children ?? null)
}

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  label: string
  icon: React.ReactNode
  size?: 'sm' | 'md'
}

/** Square icon-only button; the label is mandatory for screen readers. */
export function IconButton(props: IconButtonProps): React.ReactElement {
  const { label, icon, size = 'md', className, type, ...rest } = props
  return React.createElement('button', {
    ...rest,
    type: type ?? 'button',
    'aria-label': label,
    title: props.title ?? label,
    className: cx('vx-icon-button', size === 'sm' ? 'vx-icon-button-sm' : '', className),
  }, icon)
}

export interface SwitchProps {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
  hint?: string
  disabled?: boolean
  id?: string
}

/** Host-style switch row: label left, track right, optional hint below. */
export function Switch(props: SwitchProps): React.ReactElement {
  const generatedId = React.useId()
  const id = props.id ?? `vx-switch-${generatedId.replace(/:/g, '')}`
  const hintId = props.hint === undefined ? undefined : `${id}-hint`
  return React.createElement('div', { className: cx('vx-switch-row', props.disabled === true ? 'is-disabled' : '') },
    React.createElement('div', { className: 'vx-switch-copy' },
      React.createElement('label', { className: 'vx-switch-label', htmlFor: id }, props.label),
      props.hint === undefined ? null : React.createElement('div', { className: 'vx-switch-hint', id: hintId }, props.hint),
    ),
    React.createElement('button', {
      id,
      type: 'button',
      role: 'switch',
      'aria-checked': props.checked,
      'aria-describedby': hintId,
      disabled: props.disabled === true,
      className: cx('vx-switch', props.checked ? 'on' : ''),
      onClick: () => props.onChange(!props.checked),
    }, React.createElement('span', { className: 'vx-switch-thumb', 'aria-hidden': 'true' })),
  )
}

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: React.ReactNode
}

export interface SegmentedProps<T extends string> {
  value: T
  options: ReadonlyArray<SegmentedOption<T>>
  onChange: (value: T) => void
  label?: string
  ariaLabel?: string
}

/** Segmented control for small mutually-exclusive choices. */
export function Segmented<T extends string>(props: SegmentedProps<T>): React.ReactElement {
  return React.createElement('div', { className: 'vx-segmented', role: 'radiogroup', 'aria-label': props.ariaLabel ?? props.label },
    props.label === undefined ? null : React.createElement('span', { className: 'vx-field-label' }, props.label),
    React.createElement('div', { className: 'vx-segmented-track' },
      props.options.map((option) => React.createElement('button', {
        key: option.value,
        type: 'button',
        role: 'radio',
        'aria-checked': option.value === props.value,
        className: cx('vx-segmented-item', option.value === props.value ? 'on' : ''),
        onClick: () => props.onChange(option.value),
      }, option.icon ?? null, React.createElement('span', null, option.label))),
    ),
  )
}

export interface FieldProps {
  label: string
  hint?: string
  error?: string | null
  htmlFor?: string
  children?: React.ReactNode
}

/** Label + control + hint/error block. */
export function Field(props: FieldProps): React.ReactElement {
  return React.createElement('div', { className: 'vx-field' },
    React.createElement('label', { className: 'vx-field-label', htmlFor: props.htmlFor }, props.label),
    props.children,
    props.error !== undefined && props.error !== null
      ? React.createElement('div', { className: 'vx-field-error', role: 'alert' }, props.error)
      : (props.hint === undefined ? null : React.createElement('div', { className: 'vx-field-hint' }, props.hint)),
  )
}

export interface CardProps {
  title?: string
  description?: string
  actions?: React.ReactNode
  children?: React.ReactNode
  className?: string
  id?: string
}

/** Settings card: host surface, title row, optional description and body. */
export function Card(props: CardProps): React.ReactElement {
  return React.createElement('section', { className: cx('vx-card', props.className), id: props.id },
    props.title === undefined && props.actions === undefined
      ? null
      : React.createElement('div', { className: 'vx-card-head' },
        React.createElement('div', { className: 'vx-card-titles' },
          props.title === undefined ? null : React.createElement('h3', { className: 'vx-card-title' }, props.title),
          props.description === undefined ? null : React.createElement('p', { className: 'vx-card-desc' }, props.description),
        ),
        props.actions === undefined ? null : React.createElement('div', { className: 'vx-card-actions' }, props.actions),
      ),
    props.children === undefined ? null : React.createElement('div', { className: 'vx-card-body' }, props.children),
  )
}

export interface EmptyStateProps {
  title: string
  hint?: string
  icon?: React.ReactNode
  action?: React.ReactNode
}

/** Consistent empty state for lists and panels. */
export function EmptyState(props: EmptyStateProps): React.ReactElement {
  return React.createElement('div', { className: 'vx-empty' },
    props.icon === undefined ? null : React.createElement('div', { className: 'vx-empty-icon', 'aria-hidden': 'true' }, props.icon),
    React.createElement('div', { className: 'vx-empty-title' }, props.title),
    props.hint === undefined ? null : React.createElement('div', { className: 'vx-empty-hint' }, props.hint),
    props.action === undefined ? null : React.createElement('div', { className: 'vx-empty-action' }, props.action),
  )
}

/** Inline loading indicator with an accessible status label. */
export function Spinner(props: { label?: string }): React.ReactElement {
  return React.createElement('span', { className: 'vx-spinner', role: 'status', 'aria-label': props.label ?? '加载中' },
    React.createElement('span', { className: 'vx-spinner-dot', 'aria-hidden': 'true' }),
    React.createElement('span', { className: 'vx-spinner-dot', 'aria-hidden': 'true' }),
    React.createElement('span', { className: 'vx-spinner-dot', 'aria-hidden': 'true' }),
  )
}

export interface BadgeProps {
  children?: React.ReactNode
  tone?: 'neutral' | 'accent' | 'danger' | 'success'
}

/** Small count/status pill. */
export function Badge(props: BadgeProps): React.ReactElement {
  return React.createElement('span', { className: cx('vx-badge', props.tone === undefined ? '' : `vx-badge-${props.tone}`) }, props.children)
}

/** Keyboard keycap. */
export function Kbd(props: { children: React.ReactNode }): React.ReactElement {
  return React.createElement('kbd', { className: 'vx-kbd' }, props.children)
}
