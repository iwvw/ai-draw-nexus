import * as React from 'react'
import { Input as KumoInput, type InputProps as KumoInputProps } from '@cloudflare/kumo'

export type InputProps = Omit<KumoInputProps, 'size'> & {
  size?: KumoInputProps['size']
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ size = 'base', ...props }, ref) => <KumoInput ref={ref} size={size} {...props} />
)
Input.displayName = 'Input'

export { Input }
