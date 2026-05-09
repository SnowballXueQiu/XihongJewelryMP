declare namespace JSX {
  interface IntrinsicElements {
    'xr-try-on': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      'model-url'?: string
      'model-scale'?: string
      'model-rotation'?: string
      'model-position'?: string
      'auto-sync'?: number
    }
  }
}
