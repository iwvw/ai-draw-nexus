export const FILE_DROP_EVENT = 'ai-draw-nexus:file-drop'

export function dispatchDroppedFile(file: File): void {
  window.dispatchEvent(new CustomEvent<File>(FILE_DROP_EVENT, { detail: file }))
}
