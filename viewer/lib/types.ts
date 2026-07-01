export interface Card { id: string; title: string; content: string; x: number; y: number; width: number; height?: number }
export interface TextBox { id: string; text: string; x: number; y: number; width: number; height?: number }
export interface CanvasLabel { id: string; text: string; level: 0 | 1 | 2 | 3 | 4; x: number; y: number; width: number }
export interface Section { id: string; name: string; x: number; y: number; width: number; height: number; color: string; cardIds?: string[] }
export interface Connection { id: string; fromCardId: string; toCardId: string }
export interface CanvasViewport { panX: number; panY: number; scale: number }
export interface Canvas {
  id: string
  name: string
  shareId?: string
  cards: Card[]
  labels?: CanvasLabel[]
  sections?: Section[]
  connections?: Connection[]
  texts?: TextBox[]
  viewport?: CanvasViewport
}
export interface Snapshot { canvases: Canvas[]; activeCanvasId: string | null; [k: string]: unknown }
