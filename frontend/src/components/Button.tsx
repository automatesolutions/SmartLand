import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'

type Variant = 'primary' | 'secondary' | 'plain' | 'on-tile'
type Size = 'default' | 'large'

const base =
  'press inline-flex min-h-tap items-center justify-center gap-xs whitespace-nowrap rounded-pill font-regular disabled:cursor-not-allowed'

const variants: Record<Variant, string> = {
  // button-primary: Action Blue pill
  primary: 'bg-accent-fill text-on-accent disabled:opacity-40',
  // button-secondary-pill: ghost pill with 1px accent border
  secondary: 'border border-accent text-accent disabled:border-ink-disabled disabled:text-ink-disabled',
  // text-link styled control, still 44px tall
  plain: 'text-accent disabled:text-ink-disabled',
  // secondary pill on a dark tile uses Sky Link Blue
  'on-tile': 'border border-on-tile-accent text-on-tile-accent',
}

const sizes: Record<Size, string> = {
  default: 'px-btn-x text-body',
  large: 'px-btn-x-lg text-button-large font-light',
}

function classes(variant: Variant, size: Size, extra?: string) {
  const pad = variant === 'plain' ? 'px-xs text-body' : sizes[size]
  return [base, variants[variant], pad, extra].filter(Boolean).join(' ')
}

interface Common {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  iconAfter?: ReactNode
  className?: string
  children: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'default',
  icon,
  iconAfter,
  className,
  children,
  type = 'button',
  ...rest
}: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={classes(variant, size, className)} {...rest}>
      {icon}
      {children}
      {iconAfter}
    </button>
  )
}

export function ButtonLink({
  variant = 'primary',
  size = 'default',
  icon,
  iconAfter,
  className,
  children,
  ...rest
}: Common & LinkProps) {
  return (
    <Link className={classes(variant, size, className)} {...rest}>
      {icon}
      {children}
      {iconAfter}
    </Link>
  )
}
