import * as React from 'react'
import { Textarea as KumoTextarea } from '@cloudflare/kumo'

export type TextareaProps = React.ComponentPropsWithoutRef<typeof KumoTextarea>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (props, ref) => <KumoTextarea ref={ref} {...props} />,
)
Textarea.displayName = 'Textarea'

export { Textarea }
