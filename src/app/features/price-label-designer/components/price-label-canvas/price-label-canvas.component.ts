import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output
} from '@angular/core';
import {
  LabelElement,
  LabelElementType,
  LabelTemplate,
  PriceLabelArticle,
  PriceLabelCompany,
  PriceLabelRenderContext
} from '../../../../core/models/price-label-template.model';
import { mmToPx, pxToMm } from '../../../template-designer/utils/coordinate-utils';
import { PriceLabelRendererService } from '../../services/price-label-renderer.service';

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface DragState {
  type: 'move' | 'resize';
  element: LabelElement;
  startMouseX: number;
  startMouseY: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  handle?: ResizeHandle;
}

@Component({
  selector: 'app-price-label-canvas',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './price-label-canvas.component.html',
  styleUrl: './price-label-canvas.component.scss'
})
export class PriceLabelCanvasComponent {
  @Input({ required: true }) template!: LabelTemplate;
  @Input() selectedElementId: string | null = null;
  @Input({ required: true }) sampleArticle!: PriceLabelArticle;
  @Input({ required: true }) sampleCompany!: PriceLabelCompany;

  @Output() elementSelected = new EventEmitter<string | null>();
  @Output() elementDropped = new EventEmitter<{ type: LabelElementType; position: { x: number; y: number } }>();
  @Output() elementChanged = new EventEmitter<{ id: string; changes: Partial<LabelElement> }>();

  zoom = 3;
  private dragState: DragState | null = null;

  constructor(private renderer: PriceLabelRendererService) {}

  get labelWidthPx(): number {
    return this.mmToScreenPx(this.template.label.width);
  }

  get labelHeightPx(): number {
    return this.mmToScreenPx(this.template.label.height);
  }

  get paddingStyles(): Record<string, string> {
    const label = this.template.label;
    return {
      top: `${this.mmToScreenPx(label.paddingTop)}px`,
      right: `${this.mmToScreenPx(label.paddingRight)}px`,
      bottom: `${this.mmToScreenPx(label.paddingBottom)}px`,
      left: `${this.mmToScreenPx(label.paddingLeft)}px`
    };
  }

  zoomIn(): void {
    this.zoom = Math.min(5, Math.round((this.zoom + 0.25) * 100) / 100);
  }

  zoomOut(): void {
    this.zoom = Math.max(1, Math.round((this.zoom - 0.25) * 100) / 100);
  }

  onCanvasMouseDown(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('label-surface')) {
      this.elementSelected.emit(null);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    const type = event.dataTransfer?.getData('label-element-type') as LabelElementType;
    if (!type) return;

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const position = {
      x: roundMm(pxToMm((event.clientX - rect.left) / this.zoom)),
      y: roundMm(pxToMm((event.clientY - rect.top) / this.zoom))
    };
    this.elementDropped.emit({ type, position });
  }

  onElementMouseDown(event: MouseEvent, element: LabelElement): void {
    event.stopPropagation();
    event.preventDefault();
    this.elementSelected.emit(element.id);
    if (element.locked) return;
    this.dragState = this.createDragState('move', event, element);
  }

  onResizeMouseDown(event: MouseEvent, element: LabelElement, handle: ResizeHandle): void {
    event.stopPropagation();
    event.preventDefault();
    this.elementSelected.emit(element.id);
    if (element.locked) return;
    this.dragState = this.createDragState('resize', event, element, handle);
  }

  @HostListener('document:mousemove', ['$event'])
  onDocumentMouseMove(event: MouseEvent): void {
    if (!this.dragState) return;
    event.preventDefault();

    if (this.dragState.type === 'move') {
      this.applyMove(event);
    } else {
      this.applyResize(event);
    }
  }

  @HostListener('document:mouseup')
  onDocumentMouseUp(): void {
    this.dragState = null;
  }

  getElementStyles(element: LabelElement): Record<string, string> {
    const style: Record<string, string> = {
      left: `${this.mmToScreenPx(element.position.x)}px`,
      top: `${this.mmToScreenPx(element.position.y)}px`,
      width: `${this.mmToScreenPx(element.size.width)}px`,
      height: `${this.mmToScreenPx(element.size.height)}px`,
      zIndex: String(element.zIndex),
      opacity: String(element.style.opacity ?? 1),
      cursor: element.locked ? 'default' : 'move'
    };

    if (element.style.backgroundColor) style['background-color'] = element.style.backgroundColor;
    if (element.style.borderColor && element.style.borderWidth) {
      style['border'] = `${this.mmToScreenPx(element.style.borderWidth)}px ${element.style.borderStyle || 'solid'} ${element.style.borderColor}`;
    }
    if (element.style.borderRadius) {
      style['border-radius'] = `${this.mmToScreenPx(element.style.borderRadius)}px`;
    }

    return style;
  }

  getContentStyles(element: LabelElement): Record<string, string> {
    const style: Record<string, string> = {};
    const font = element.style.font;
    if (font) {
      style['font-family'] = font.family;
      style['font-size'] = `${font.size * this.zoom / 2.4}px`;
      style['font-weight'] = font.weight;
      style['font-style'] = font.style;
      style['color'] = font.color;
    }
    if (element.style.textAlign) style['text-align'] = element.style.textAlign;
    if (element.style.verticalAlign) {
      style['display'] = 'flex';
      style['align-items'] = element.style.verticalAlign === 'middle'
        ? 'center'
        : element.style.verticalAlign === 'bottom'
          ? 'flex-end'
          : 'flex-start';
      if (element.style.textAlign === 'center') style['justify-content'] = 'center';
      if (element.style.textAlign === 'right') style['justify-content'] = 'flex-end';
    }
    return style;
  }

  isSelected(element: LabelElement): boolean {
    return element.id === this.selectedElementId;
  }

  displayValue(element: LabelElement): string {
    const context = this.sampleContext;
    if (element.type === 'text') {
      const value = element.binding
        ? this.renderer.resolvePath(element.binding, context)
        : element.content;
      return String(value ?? '');
    }
    if (element.type === 'price') {
      const value = this.renderer.resolvePath(element.binding, context);
      const symbol = element.currencyPath
        ? String(this.renderer.resolvePath(element.currencyPath, context) ?? '')
        : '';
      return `${element.prefix || ''}${symbol} ${this.renderer.formatPrice(value, element.decimals)}`.trim();
    }
    if (element.type === 'barcode') {
      return String(this.renderer.resolvePath(element.binding, context) ?? '');
    }
    return '';
  }

  imageSource(element: LabelElement): string {
    if (element.type !== 'image') return '';
    return element.sourceType === 'binding'
      ? String(this.renderer.resolvePath(element.binding, this.sampleContext) ?? '')
      : (element.url || '');
  }

  imageFit(element: LabelElement): string {
    if (element.type !== 'image') return 'contain';
    return element.fit === 'stretch' ? 'fill' : element.fit;
  }

  trackElement(_index: number, element: LabelElement): string {
    return element.id;
  }

  private get sampleContext(): PriceLabelRenderContext {
    return {
      article: this.sampleArticle,
      company: this.sampleCompany
    };
  }

  private createDragState(
    type: 'move' | 'resize',
    event: MouseEvent,
    element: LabelElement,
    handle?: ResizeHandle
  ): DragState {
    return {
      type,
      element,
      startMouseX: event.clientX,
      startMouseY: event.clientY,
      startX: element.position.x,
      startY: element.position.y,
      startWidth: element.size.width,
      startHeight: element.size.height,
      handle
    };
  }

  private applyMove(event: MouseEvent): void {
    const state = this.dragState!;
    const dx = pxToMm((event.clientX - state.startMouseX) / this.zoom);
    const dy = pxToMm((event.clientY - state.startMouseY) / this.zoom);
    const maxX = Math.max(0, this.template.label.width - state.startWidth);
    const maxY = Math.max(0, this.template.label.height - state.startHeight);

    this.elementChanged.emit({
      id: state.element.id,
      changes: {
        position: {
          x: roundMm(clamp(state.startX + dx, 0, maxX)),
          y: roundMm(clamp(state.startY + dy, 0, maxY))
        }
      } as Partial<LabelElement>
    });
  }

  private applyResize(event: MouseEvent): void {
    const state = this.dragState!;
    const dx = pxToMm((event.clientX - state.startMouseX) / this.zoom);
    const dy = pxToMm((event.clientY - state.startMouseY) / this.zoom);
    const handle = state.handle || 'se';
    const min = 2;

    let x = state.startX;
    let y = state.startY;
    let width = state.startWidth;
    let height = state.startHeight;

    if (handle.includes('e')) width = state.startWidth + dx;
    if (handle.includes('s')) height = state.startHeight + dy;
    if (handle.includes('w')) {
      width = state.startWidth - dx;
      x = state.startX + dx;
    }
    if (handle.includes('n')) {
      height = state.startHeight - dy;
      y = state.startY + dy;
    }

    width = clamp(width, min, this.template.label.width - x);
    height = clamp(height, min, this.template.label.height - y);
    x = clamp(x, 0, this.template.label.width - width);
    y = clamp(y, 0, this.template.label.height - height);

    this.elementChanged.emit({
      id: state.element.id,
      changes: {
        position: { x: roundMm(x), y: roundMm(y) },
        size: { width: roundMm(width), height: roundMm(height) }
      } as Partial<LabelElement>
    });
  }

  private mmToScreenPx(mm: number): number {
    return mmToPx(mm) * this.zoom;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function roundMm(value: number): number {
  return Math.round(value * 10) / 10;
}
