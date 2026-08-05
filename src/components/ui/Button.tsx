import * as React from 'react'
import { Button as KumoButton, cn, type ButtonProps as KumoButtonProps } from '@cloudflare/kumo'

type LegacyButtonVariant = 'default' | 'primary' | 'secondary' | 'outline' | 'ghost' | 'link' | 'destructive'
type LegacyButtonSize = 'sm' | 'md' | 'lg' | 'icon' | NonNullable<KumoButtonProps['size']>

export interface ButtonProps extends Omit<KumoButtonProps, 'variant' | 'size' | 'shape'> {
  variant?: LegacyButtonVariant
  size?: LegacyButtonSize
  shape?: KumoButtonProps['shape']
  asChild?: boolean
}

const variantMap: Record<NonNullable<ButtonProps['variant']>, KumoButtonProps['variant']> = {
  default: 'primary',
  primary: 'primary',
  secondary: 'secondary',
  outline: 'outline',
  ghost: 'ghost',
  link: 'ghost',
  destructive: 'destructive',
}

function mapSize(size: NonNullable<ButtonProps['size']>): KumoButtonProps['size'] {
  if (size === 'md' || size === 'icon') return 'base'
  return size
}

const KumoButtonCompat = KumoButton as React.ForwardRefExoticComponent<
  Record<string, unknown> & { children?: React.ReactNode } & React.RefAttributes<HTMLButtonElement>
>

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', shape, asChild = false, children, ...props }, ref) => {
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children, {
        ...props,
        className: cn((children.props as { className?: string }).className, className),
      } as React.HTMLAttributes<HTMLElement>)
    }

    const isIconButton = size === 'icon'
    const ariaLabel = props['aria-label'] ?? (typeof props.title === 'string' ? props.title : undefined)

    return (
      <KumoButtonCompat
        ref={ref}
        variant={variantMap[variant]}
        size={mapSize(size)}
        shape={shape ?? (isIconButton ? 'square' : 'base')}
        aria-label={isIconButton ? ariaLabel || '按钮' : ariaLabel}
        className={cn(variant === 'link' && 'px-0 text-kumo-link underline-offset-4 hover:underline', className)}
        {...(props as Omit<KumoButtonProps, 'variant' | 'size' | 'shape'>)}
      >
        {children}
      </KumoButtonCompat>
    )
  }
)
Button.displayName = 'Button'

export { Button }
