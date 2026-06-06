/**
 * Design Canvas Component
 * The central A4 surface where users place and manipulate elements.
 * Renders header, detail, and footer sections with proper mm→px sizing.
 * Uses native mouse events for drag & resize.
 */
import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ElementRef,
  ViewChild,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  NgZone,
  HostListener
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';
import {
  ReportTemplate,
  TemplateElement,
  PageSettings
} from '../../../../core/models/template.model';
import { TemplateStateService } from '../../services/template-state.service';
import { SelectionService } from '../../services/selection.service';
import {
  mmToPx, pxToMm, snapToGrid, PAPER_PRESETS, PaperPreset,
  SnapLine, SnapCandidate, SnapSettings, collectSnapCandidates, computeSnap
} from '../../utils/coordinate-utils';
import { createElement } from '../../utils/element-factory';
import { FormsModule } from '@angular/forms';
import { ElementRendererComponent } from '../element-renderer/element-renderer.component';

type SectionKey = 'header' | 'detail' | 'footer';

/** Cached snap candidates valid for the entire drag duration */
interface CachedSnapCandidates {
  horizontal: SnapCandidate[];
  vertical: SnapCandidate[];
}

/** Tracks an active drag or resize operation (single element) */
interface DragState {
  type: 'move' | 'resize';
  elementId: string;
  section: SectionKey;
  startMouseX: number;
  startMouseY: number;
  startElX: number;       // original element position in mm
  startElY: number;
  startElWidth: number;   // original element size in mm
  startElHeight: number;
  resizeHandle?: string;  // 'nw','n','ne','e','se','s','sw','w'
  /** Current offset in px (for real-time visual feedback) */
  currentDx: number;
  currentDy: number;
  currentWidth: number;   // in px, for resize visual feedback
  currentHeight: number;  // in px, for resize visual feedback
  /** Cached snap candidates (other elements don't move during drag) */
  snapCandidates: CachedSnapCandidates;
  /** Cached size at drag start (avoid repeated getElement lookups in mousemove) */
  cachedSize: { width: number; height: number };
}

/** Tracks a multi-element move operation */
interface MultiDragState {
  type: 'multi-move';
  anchorElementId: string;
  section: SectionKey;
  startMouseX: number;
  startMouseY: number;
  startPositions: Map<string, { x: number; y: number }>;
  currentDx: number;
  currentDy: number;
  snapCandidates: CachedSnapCandidates;
  anchorSize: { width: number; height: number };
}

/** Tracks an active marquee (rubber-band) selection */
interface MarqueeState {
  startClientX: number;
  startClientY: number;
  startXMm: number;
  startYMm: number;
  currentXMm: number;
  currentYMm: number;
  additive: boolean;
  previousIds: string[];
  sectionBodyRect: DOMRect;
  section: SectionKey;
}

@Component({
  selector: 'app-design-canvas',
  standalone: true,
  imports: [CommonModule, FormsModule, ElementRendererComponent],
  templateUrl: './design-canvas.component.html',
  styleUrl: './design-canvas.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DesignCanvasComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('canvasPage') canvasPage!: ElementRef<HTMLDivElement>;
  @ViewChild('scrollArea') scrollArea!: ElementRef<HTMLDivElement>;

  template!: ReportTemplate;
  selectedIds = new Set<string>();
  activeSection: SectionKey = 'header';

  // Page dimensions in px (computed from mm)
  pageWidthPx = 0;
  pageHeightPx = 0;
  contentWidthPx = 0;

  // Section heights in px
  headerHeightPx = 0;
  detailHeightPx = 0;
  footerHeightPx = 0;

  // Grid settings
  gridSizeMm = 5;
  showGrid = true;
  snapSettings: SnapSettings = {
    snapToGrid: true,
    snapToElement: true,
    thresholdMm: 2
  };

  // Smart snap lines (ephemeral, shown during element drag)
  activeSnapLines: SnapLine[] = [];

  // Zoom
  readonly ZOOM_MIN = 0.25;
  readonly ZOOM_MAX = 2;
  readonly ZOOM_STEP = 0.05;
  zoom = 1;
  private wheelHandler: ((e: WheelEvent) => void) | null = null;

  // Paper size
  paperPresets = PAPER_PRESETS;
  selectedPaperType = 'a4';
  customWidth = 210;
  customHeight = 297;

  // Ruler marks (only rebuilt when page dimensions change)
  horizontalMarks: number[] = [];
  verticalMarks: number[] = [];
  private lastMarkedWidth = -1;
  private lastMarkedHeight = -1;

  // Drag/resize state
  dragState: DragState | MultiDragState | null = null;

  // Marquee selection state
  marqueeState: MarqueeState | null = null;

  // rAF throttle for mousemove → CD
  private rafHandle: number | null = null;
  private pendingMouseEvent: MouseEvent | null = null;

  // Document-level listeners (managed manually to run outside NgZone)
  private docMouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private docMouseUpHandler: ((e: MouseEvent) => void) | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    public templateState: TemplateStateService,
    private selectionService: SelectionService,
    public cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    // Split subscriptions so high-frequency selection updates (during marquee)
    // don't re-run the page-dimension recompute. Each stream only drives the
    // state it actually owns, then calls markForCheck once.
    this.templateState.template$
      .pipe(takeUntil(this.destroy$))
      .subscribe(template => {
        this.template = template;
        this.computeDimensions();
        this.cdr.markForCheck();
      });

    this.selectionService.selectedIds$
      .pipe(takeUntil(this.destroy$))
      .subscribe(selectedIds => {
        this.selectedIds = selectedIds;
        this.cdr.markForCheck();
      });

    this.selectionService.activeSection$
      .pipe(takeUntil(this.destroy$), distinctUntilChanged())
      .subscribe(activeSection => {
        this.activeSection = activeSection;
        this.cdr.markForCheck();
      });
  }

  ngAfterViewInit(): void {
    // Register wheel + document mouse listeners OUTSIDE Angular zone.
    // This prevents change detection from firing on every mousemove
    // globally — a huge perf win because mousemove is extremely noisy.
    // We manually re-enter the zone (or call markForCheck) only when
    // the drag/marquee state actually needs to update the UI.
    this.ngZone.runOutsideAngular(() => {
      this.wheelHandler = (e: WheelEvent) => this.onWheel(e);
      this.scrollArea.nativeElement.addEventListener('wheel', this.wheelHandler, { passive: false });

      this.docMouseMoveHandler = (e: MouseEvent) => this.onDocumentMouseMove(e);
      this.docMouseUpHandler = (e: MouseEvent) => this.onDocumentMouseUp(e);
      document.addEventListener('mousemove', this.docMouseMoveHandler);
      document.addEventListener('mouseup', this.docMouseUpHandler);
    });
  }

  ngOnDestroy(): void {
    if (this.wheelHandler && this.scrollArea?.nativeElement) {
      this.scrollArea.nativeElement.removeEventListener('wheel', this.wheelHandler);
    }
    if (this.docMouseMoveHandler) {
      document.removeEventListener('mousemove', this.docMouseMoveHandler);
    }
    if (this.docMouseUpHandler) {
      document.removeEventListener('mouseup', this.docMouseUpHandler);
    }
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ─── Global mouse listeners (registered outside NgZone in ngAfterViewInit) ───

  /**
   * Fast path: runs OUTSIDE NgZone on every mousemove. Stores the latest
   * event and schedules a single rAF tick to apply updates + trigger CD.
   * This coalesces bursts of mousemove events into one frame's worth of work.
   */
  private onDocumentMouseMove(event: MouseEvent): void {
    // Cheap early exit when idle — no zone entry, no CD.
    if (!this.dragState && !this.marqueeState) return;

    // Prevent selection while dragging; cheap enough to do synchronously.
    event.preventDefault();

    this.pendingMouseEvent = event;
    if (this.rafHandle === null) {
      this.rafHandle = requestAnimationFrame(() => {
        this.rafHandle = null;
        const ev = this.pendingMouseEvent;
        this.pendingMouseEvent = null;
        if (ev) this.processMouseMove(ev);
      });
    }
  }

  /** Runs once per animation frame. May enter NgZone to trigger CD. */
  private processMouseMove(event: MouseEvent): void {
    // ─── Marquee drag ───
    if (this.marqueeState) {
      const rect = this.marqueeState.sectionBodyRect;
      this.marqueeState.currentXMm = pxToMm((event.clientX - rect.left) / this.zoom);
      this.marqueeState.currentYMm = pxToMm((event.clientY - rect.top) / this.zoom);

      // Compute which elements intersect the marquee
      const ids = this.getElementsInMarquee();
      // Run selection updates inside the zone so observers fire through CD.
      this.ngZone.run(() => {
        if (this.marqueeState!.additive) {
          const union = new Set([...this.marqueeState!.previousIds, ...ids]);
          this.selectionService.selectMultiple(Array.from(union), this.marqueeState!.section);
        } else {
          this.selectionService.selectMultiple(ids, this.marqueeState!.section);
        }
        this.cdr.markForCheck();
      });
      return;
    }

    if (!this.dragState) return;

    const dx = event.clientX - this.dragState.startMouseX;
    const dy = event.clientY - this.dragState.startMouseY;

    if (this.dragState.type === 'move') {
      const state = this.dragState as DragState;
      const proposedX = state.startElX + pxToMm(dx / this.zoom);
      const proposedY = state.startElY + pxToMm(dy / this.zoom);
      const snap = computeSnap(
        { x: proposedX, y: proposedY }, state.cachedSize,
        state.snapCandidates, this.snapSettings.thresholdMm,
        this.gridSizeMm, this.snapSettings.snapToGrid
      );
      this.activeSnapLines = snap.snapLines;
      state.currentDx = mmToPx(snap.x - state.startElX) * this.zoom;
      state.currentDy = mmToPx(snap.y - state.startElY) * this.zoom;
    } else if (this.dragState.type === 'multi-move') {
      const state = this.dragState;
      state.currentDx = dx;
      state.currentDy = dy;
      const startPos = state.startPositions.get(state.anchorElementId);
      if (startPos) {
        const proposedX = startPos.x + pxToMm(dx / this.zoom);
        const proposedY = startPos.y + pxToMm(dy / this.zoom);
        const snap = computeSnap(
          { x: proposedX, y: proposedY }, state.anchorSize,
          state.snapCandidates, this.snapSettings.thresholdMm,
          this.gridSizeMm, this.snapSettings.snapToGrid
        );
        this.activeSnapLines = snap.snapLines;
      }
    } else if (this.dragState.type === 'resize') {
      this.applyResizeDelta(dx, dy);
    }

    // Only trigger CD; no observable updates, so no need to enter the zone.
    this.cdr.markForCheck();
  }

  private onDocumentMouseUp(event: MouseEvent): void {
    if (!this.marqueeState && !this.dragState) return;

    // Cancel any pending rAF tick to avoid stale state writes after teardown.
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
      this.pendingMouseEvent = null;
    }

    // State mutations that emit through observables must run in the zone.
    this.ngZone.run(() => {
      // ─── End marquee ───
      if (this.marqueeState) {
        const dx = event.clientX - this.marqueeState.startClientX;
        const dy = event.clientY - this.marqueeState.startClientY;
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
          this.selectionService.clearSelection();
        }
        this.marqueeState = null;
        this.cdr.markForCheck();
        return;
      }

      if (!this.dragState) return;

      if (this.dragState.type === 'move') {
        this.commitMove();
      } else if (this.dragState.type === 'multi-move') {
        this.commitMultiMove();
      } else if (this.dragState.type === 'resize') {
        this.commitResize();
      }

      this.dragState = null;
      this.activeSnapLines = [];
      this.cdr.markForCheck();
    });
  }

  // ─── Keyboard shortcuts ───

  @HostListener('document:keydown', ['$event'])
  onDocumentKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    const tag = target.tagName.toLowerCase();
    const isInput = tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;

    // Ctrl+Z / Cmd+Z → Undo
    if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
      if (!isInput) {
        event.preventDefault();
        this.templateState.undo();
        this.cdr.markForCheck();
        return;
      }
    }

    // Ctrl+Y / Cmd+Y / Ctrl+Shift+Z → Redo
    if (
      ((event.ctrlKey || event.metaKey) && event.key === 'y') ||
      ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'z') ||
      ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'Z')
    ) {
      if (!isInput) {
        event.preventDefault();
        this.templateState.redo();
        this.cdr.markForCheck();
        return;
      }
    }

    // Delete/Backspace → remove selected elements (skip if user is typing in an input)
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (isInput) return;

      if (this.selectedIds.size > 0) {
        event.preventDefault();
        const idsToDelete = Array.from(this.selectedIds);
        for (const id of idsToDelete) {
          this.templateState.removeElement(this.activeSection as any, id);
        }
        this.selectionService.clearSelection();
        this.cdr.markForCheck();
      }
    }
  }

  // ─── Compute dimensions ───

  private computeDimensions(): void {
    if (!this.template) return;

    const page = this.template.page;
    this.pageWidthPx = mmToPx(page.width);
    this.pageHeightPx = mmToPx(page.height);
    this.contentWidthPx = mmToPx(page.width - page.margins.left - page.margins.right);

    this.headerHeightPx = mmToPx(this.template.sections.header.height);
    this.detailHeightPx = mmToPx(this.template.sections.detail.height);
    this.footerHeightPx = mmToPx(this.template.sections.footer.height);

    // Sync paper selector state from template
    this.selectedPaperType = page.paperType || 'a4';
    if (this.selectedPaperType === 'custom') {
      this.customWidth = page.width;
      this.customHeight = page.height;
    }

    // Only rebuild ruler marks when paper dimensions actually change.
    // Avoids thrashing the two large @for loops on every template emission.
    if (page.width !== this.lastMarkedWidth) {
      const hm: number[] = [];
      for (let mm = 0; mm <= page.width; mm += 5) hm.push(mm);
      this.horizontalMarks = hm;
      this.lastMarkedWidth = page.width;
    }
    if (page.height !== this.lastMarkedHeight) {
      const vm: number[] = [];
      for (let mm = 0; mm <= page.height; mm += 5) vm.push(mm);
      this.verticalMarks = vm;
      this.lastMarkedHeight = page.height;
    }
  }

  /** mmToPx exposed to template for binding */
  mmToPx(mm: number): number {
    return mmToPx(mm);
  }

  // ─── Canvas click (deselect) ───

  onCanvasClick(event: MouseEvent): void {
    // Deselection is now handled by marquee mouseup (tiny-move = click = clear).
    // Only clear when clicking canvas-page or section-area directly (not section-body,
    // which is handled by onSectionBodyMouseDown for marquee).
    const target = event.target as HTMLElement;
    if (
      target.classList.contains('canvas-page') ||
      target.classList.contains('section-area')
    ) {
      this.selectionService.clearSelection();
    }
  }

  // ─── Marquee selection (rubber-band) ───

  onSectionBodyMouseDown(event: MouseEvent, section: SectionKey): void {
    // Only start marquee from empty space (section-body itself)
    const target = event.target as HTMLElement;
    if (!target.classList.contains('section-body')) return;
    if (event.button !== 0) return; // left-click only

    const rect = target.getBoundingClientRect();
    const xMm = pxToMm((event.clientX - rect.left) / this.zoom);
    const yMm = pxToMm((event.clientY - rect.top) / this.zoom);

    this.marqueeState = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      startXMm: xMm,
      startYMm: yMm,
      currentXMm: xMm,
      currentYMm: yMm,
      additive: event.shiftKey,
      previousIds: event.shiftKey ? Array.from(this.selectedIds) : [],
      sectionBodyRect: rect,
      section
    };

    this.selectionService.setActiveSection(section);
    if (!event.shiftKey) {
      this.selectionService.clearSelection();
    }

    event.preventDefault();
  }

  /** Get marquee rectangle normalized (min/max) in mm */
  get marqueeRect(): { x: number; y: number; w: number; h: number } | null {
    if (!this.marqueeState) return null;
    const x1 = Math.min(this.marqueeState.startXMm, this.marqueeState.currentXMm);
    const y1 = Math.min(this.marqueeState.startYMm, this.marqueeState.currentYMm);
    const x2 = Math.max(this.marqueeState.startXMm, this.marqueeState.currentXMm);
    const y2 = Math.max(this.marqueeState.startYMm, this.marqueeState.currentYMm);
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  /** Find elements whose bounding box intersects the marquee */
  private getElementsInMarquee(): string[] {
    if (!this.marqueeState) return [];
    const rect = this.marqueeRect!;
    const x1 = rect.x;
    const y1 = rect.y;
    const x2 = rect.x + rect.w;
    const y2 = rect.y + rect.h;

    return this.getSectionElements(this.marqueeState.section)
      .filter(el => !el.locked &&
        el.position.x < x2 &&
        el.position.x + el.size.width > x1 &&
        el.position.y < y2 &&
        el.position.y + el.size.height > y1
      )
      .map(el => el.id);
  }

  // ─── Element selection ───

  onElementSelected(event: {
    elementId: string;
    section: SectionKey;
    event: MouseEvent;
  }): void {
    if (event.event.shiftKey) {
      this.selectionService.toggleSelect(event.elementId, event.section);
    } else if (this.selectedIds.size > 1 && this.selectedIds.has(event.elementId)) {
      // Element is already part of a multi-selection — keep selection intact for multi-drag
      // (selection will be reduced to single on mouseup if no drag occurred)
    } else {
      this.selectionService.select(event.elementId, event.section);
    }
  }

  isElementSelected(elementId: string): boolean {
    return this.selectedIds.has(elementId);
  }

  // ─── Section helpers ───

  getSectionLabel(key: SectionKey): string {
    const labels: Record<SectionKey, string> = {
      header: 'Encabezado',
      detail: 'Detalle',
      footer: 'Pie'
    };
    return labels[key];
  }

  getSectionHeightPx(key: SectionKey): number {
    switch (key) {
      case 'header': return this.headerHeightPx;
      case 'detail': return this.detailHeightPx;
      case 'footer': return this.footerHeightPx;
    }
  }

  getSectionElements(key: SectionKey): TemplateElement[] {
    const section = this.template?.sections[key];
    return section?.elements || [];
  }

  trackByElementId(index: number, element: TemplateElement): string {
    return element.id;
  }

  isSectionActive(key: SectionKey): boolean {
    return this.activeSection === key;
  }

  onSectionLabelClick(section: SectionKey): void {
    this.selectionService.setActiveSection(section);
  }

  // ─── Drag start (from element-renderer mousedown) ───

  onElementDragStart(event: {
    elementId: string;
    section: SectionKey;
    mouseEvent: MouseEvent;
    handle?: string;
  }): void {
    const el = this.templateState.getElement(event.section as any, event.elementId);
    if (!el || el.locked) return;

    const isResize = !!event.handle;

    // Multi-drag: if multiple elements selected and dragged element is in selection (no resize)
    if (!isResize && this.selectedIds.size > 1 && this.selectedIds.has(event.elementId)) {
      const startPositions = new Map<string, { x: number; y: number }>();
      this.selectedIds.forEach(id => {
        const selEl = this.templateState.getElement(event.section as any, id);
        if (selEl && !selEl.locked) {
          startPositions.set(id, { x: selEl.position.x, y: selEl.position.y });
        }
      });

      // Cache snap candidates for the duration of the drag — other
      // elements don't move, so recomputing per-mousemove is wasted work.
      const excludeIds = new Set(startPositions.keys());
      const snapCandidates = collectSnapCandidates(
        this.getSectionElements(event.section), excludeIds, this.snapSettings
      );

      this.dragState = {
        type: 'multi-move',
        anchorElementId: event.elementId,
        section: event.section,
        startMouseX: event.mouseEvent.clientX,
        startMouseY: event.mouseEvent.clientY,
        startPositions,
        currentDx: 0,
        currentDy: 0,
        snapCandidates,
        anchorSize: { width: el.size.width, height: el.size.height }
      };
      return;
    }

    // Single-element drag: cache candidates + size
    const excludeIds = new Set([event.elementId]);
    const snapCandidates = collectSnapCandidates(
      this.getSectionElements(event.section), excludeIds, this.snapSettings
    );

    this.dragState = {
      type: isResize ? 'resize' : 'move',
      elementId: event.elementId,
      section: event.section,
      startMouseX: event.mouseEvent.clientX,
      startMouseY: event.mouseEvent.clientY,
      startElX: el.position.x,
      startElY: el.position.y,
      startElWidth: el.size.width,
      startElHeight: el.size.height,
      resizeHandle: event.handle,
      currentDx: 0,
      currentDy: 0,
      currentWidth: mmToPx(el.size.width),
      currentHeight: mmToPx(el.size.height),
      snapCandidates,
      cachedSize: { width: el.size.width, height: el.size.height }
    };
  }

  // ─── Get element visual transform during drag ───

  getElementTransform(elementId: string): string {
    if (!this.dragState) return '';
    // Multi-move: same transform for all selected elements
    if (this.dragState.type === 'multi-move' && this.dragState.startPositions.has(elementId)) {
      return `translate(${this.dragState.currentDx}px, ${this.dragState.currentDy}px)`;
    }
    // Single move
    if (this.dragState.type === 'move' && (this.dragState as DragState).elementId === elementId) {
      return `translate(${this.dragState.currentDx}px, ${this.dragState.currentDy}px)`;
    }
    return '';
  }

  getElementDragWidth(elementId: string): number | null {
    if (!this.dragState || this.dragState.type !== 'resize') return null;
    if ((this.dragState as DragState).elementId !== elementId) return null;
    return (this.dragState as DragState).currentWidth;
  }

  getElementDragHeight(elementId: string): number | null {
    if (!this.dragState || this.dragState.type !== 'resize') return null;
    if ((this.dragState as DragState).elementId !== elementId) return null;
    return (this.dragState as DragState).currentHeight;
  }

  getElementDragTransform(elementId: string): string {
    if (!this.dragState || this.dragState.type !== 'resize') return '';
    if ((this.dragState as DragState).elementId !== elementId) return '';
    return `translate(${this.dragState.currentDx}px, ${this.dragState.currentDy}px)`;
  }

  isDragging(elementId: string): boolean {
    if (!this.dragState) return false;
    if (this.dragState.type === 'multi-move') {
      return this.dragState.startPositions.has(elementId);
    }
    return (this.dragState as DragState).elementId === elementId;
  }

  // ─── Resize delta calculation ───

  private applyResizeDelta(dx: number, dy: number): void {
    if (!this.dragState || this.dragState.type !== 'resize') return;
    const state = this.dragState as DragState;

    const handle = state.resizeHandle || 'se';
    const startW = mmToPx(state.startElWidth);
    const startH = mmToPx(state.startElHeight);
    const minSize = mmToPx(2); // minimum 2mm

    // Compensate for zoom: mouse deltas are in screen pixels,
    // but element dimensions are in canvas (unzoomed) pixels
    const zoomedDx = dx / this.zoom;
    const zoomedDy = dy / this.zoom;

    let newW = startW;
    let newH = startH;
    let offsetDx = 0;
    let offsetDy = 0;

    // Right edge
    if (handle.includes('e')) {
      newW = Math.max(minSize, startW + zoomedDx);
    }
    // Left edge
    if (handle.includes('w')) {
      newW = Math.max(minSize, startW - zoomedDx);
      offsetDx = startW - newW; // shift position
    }
    // Bottom edge
    if (handle.includes('s')) {
      newH = Math.max(minSize, startH + zoomedDy);
    }
    // Top edge
    if (handle.includes('n')) {
      newH = Math.max(minSize, startH - zoomedDy);
      offsetDy = startH - newH;
    }

    state.currentWidth = newW;
    state.currentHeight = newH;
    state.currentDx = offsetDx;
    state.currentDy = offsetDy;
  }

  // ─── Section-offset helpers (for cross-section drag) ───

  /**
   * Vertical offset (in mm) of the top edge of a section measured from
   * the top of the content stack (header.top = 0).
   */
  private getSectionOffsetMm(section: SectionKey): number {
    const s = this.template.sections;
    switch (section) {
      case 'header': return 0;
      case 'detail': return s.header.height;
      case 'footer': return s.header.height + s.detail.height;
    }
  }

  /**
   * Given an absolute Y (mm from the top of the content stack), return
   * which section owns that Y and the Y rebased to that section's local
   * origin. The absoluteY is clamped to [0, totalStackHeight) so an
   * element dragged far above/below always lands in a valid section.
   */
  private resolveTargetSection(absoluteYmm: number): {
    section: SectionKey;
    localY: number;
  } {
    const s = this.template.sections;
    const hH = s.header.height;
    const hD = s.detail.height;
    const hF = s.footer.height;
    const total = hH + hD + hF;

    // Clamp inside the full stack (epsilon keeps footer reachable)
    const y = Math.max(0, Math.min(total - 0.001, absoluteYmm));

    if (y < hH) return { section: 'header', localY: y };
    if (y < hH + hD) return { section: 'detail', localY: y - hH };
    return { section: 'footer', localY: y - hH - hD };
  }

  // ─── Commit move to state ───

  private commitMove(): void {
    if (!this.dragState || this.dragState.type !== 'move') return;
    const state = this.dragState as DragState;

    const dx = state.currentDx;
    const dy = state.currentDy;

    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return; // no meaningful move

    const el = this.templateState.getElement(state.section as any, state.elementId);

    // X: clamp to [0, pageWidth - elementWidth]
    const pageW = this.template.page.width;
    const elW = el?.size.width ?? 0;
    const elH = el?.size.height ?? 0;
    const maxX = Math.max(0, pageW - elW);
    const proposedX = state.startElX + pxToMm(dx / this.zoom);
    const newX = Math.max(0, Math.min(maxX, proposedX));

    // Y: compute absolute page-Y, resolve target section, rebase.
    const proposedLocalY = state.startElY + pxToMm(dy / this.zoom);
    const absoluteY = this.getSectionOffsetMm(state.section) + proposedLocalY;
    const { section: targetSection, localY } = this.resolveTargetSection(absoluteY);

    // Clamp Y inside the destination section
    const sectionH = this.template.sections[targetSection].height;
    const maxLocalY = Math.max(0, sectionH - elH);
    const newY = Math.max(0, Math.min(maxLocalY, localY));

    if (targetSection === state.section) {
      this.templateState.updateElement(
        state.section as any,
        state.elementId,
        { position: { x: newX, y: newY } } as any
      );
    } else {
      this.templateState.moveElementToSection(
        state.section as any,
        targetSection as any,
        state.elementId,
        { x: newX, y: newY }
      );
      // Re-select in the destination section so the Properties panel
      // and active-section tracking stay in sync.
      this.selectionService.select(state.elementId, targetSection);
    }
  }

  // ─── Commit multi-move to state ───

  private commitMultiMove(): void {
    if (!this.dragState || this.dragState.type !== 'multi-move') return;

    const dx = this.dragState.currentDx;
    const dy = this.dragState.currentDy;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

    // Compute snap delta from anchor element (reuse candidates cached at drag start)
    let snapDeltaX = 0;
    let snapDeltaY = 0;
    const startPos = this.dragState.startPositions.get(this.dragState.anchorElementId);
    if (startPos) {
      const proposedX = startPos.x + pxToMm(dx / this.zoom);
      const proposedY = startPos.y + pxToMm(dy / this.zoom);
      const snap = computeSnap(
        { x: proposedX, y: proposedY }, this.dragState.anchorSize,
        this.dragState.snapCandidates, this.snapSettings.thresholdMm,
        this.gridSizeMm, this.snapSettings.snapToGrid
      );
      snapDeltaX = snap.x - proposedX;
      snapDeltaY = snap.y - proposedY;
    }

    // Determine destination section from the anchor's absolute y
    const anchorStart = this.dragState.startPositions.get(this.dragState.anchorElementId);
    let targetSection: SectionKey = this.dragState.section;
    let sectionDeltaMm = 0;
    if (anchorStart) {
      const anchorNewLocalY = anchorStart.y + pxToMm(dy / this.zoom) + snapDeltaY;
      const anchorAbsY = this.getSectionOffsetMm(this.dragState.section) + anchorNewLocalY;
      const resolved = this.resolveTargetSection(anchorAbsY);
      targetSection = resolved.section;
      // Offset to rebase every element's local y from origin→destination
      sectionDeltaMm =
        this.getSectionOffsetMm(this.dragState.section) -
        this.getSectionOffsetMm(targetSection);
    }

    const pageW = this.template.page.width;
    const targetH = this.template.sections[targetSection].height;
    const updates: Array<{ id: string; position: { x: number; y: number } }> = [];

    this.dragState.startPositions.forEach((sp, id) => {
      const el = this.templateState.getElement(this.dragState!.section as any, id);
      const elW = el?.size.width ?? 0;
      const elH = el?.size.height ?? 0;

      let newX = sp.x + pxToMm(dx / this.zoom) + snapDeltaX;
      let newY = sp.y + pxToMm(dy / this.zoom) + snapDeltaY + sectionDeltaMm;

      newX = Math.max(0, Math.min(Math.max(0, pageW - elW), newX));
      newY = Math.max(0, Math.min(Math.max(0, targetH - elH), newY));
      updates.push({ id, position: { x: newX, y: newY } });
    });

    this.templateState.moveMultipleElementsToSection(
      this.dragState.section as any,
      targetSection as any,
      updates
    );

    if (targetSection !== this.dragState.section) {
      this.selectionService.selectMultiple(
        updates.map(u => u.id),
        targetSection
      );
    }
  }

  // ─── Commit resize to state ───

  private commitResize(): void {
    if (!this.dragState || this.dragState.type !== 'resize') return;
    const state = this.dragState as DragState;

    // currentWidth/Height and currentDx/Dy are already zoom-compensated
    // (zoom was applied in applyResizeDelta), so convert px→mm directly
    let newWidth = pxToMm(state.currentWidth);
    let newHeight = pxToMm(state.currentHeight);
    let newX = state.startElX + pxToMm(state.currentDx);
    let newY = state.startElY + pxToMm(state.currentDy);

    // Apply snap to the resulting edges (use cached candidates from drag start)
    const candidates = state.snapCandidates;
    const snap = computeSnap(
      { x: newX, y: newY },
      { width: newWidth, height: newHeight },
      candidates, this.snapSettings.thresholdMm,
      this.gridSizeMm, this.snapSettings.snapToGrid
    );
    newX = snap.x;
    newY = snap.y;

    // Also snap width/height to grid if grid snap is active
    if (this.snapSettings.snapToGrid) {
      newWidth = snapToGrid(newWidth, this.gridSizeMm);
      newHeight = snapToGrid(newHeight, this.gridSizeMm);
    }

    newWidth = Math.max(2, newWidth);
    newHeight = Math.max(2, newHeight);
    newX = Math.max(0, newX);
    newY = Math.max(0, newY);

    this.templateState.updateElement(
      state.section as any,
      state.elementId,
      {
        position: { x: newX, y: newY },
        size: { width: newWidth, height: newHeight }
      } as any
    );
  }

  // ─── Toolbox drop ───

  onDrop(event: DragEvent, section: SectionKey): void {
    event.preventDefault();
    const elementType = event.dataTransfer?.getData('element-type');
    if (!elementType) return;

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const xPx = event.clientX - rect.left;
    const yPx = event.clientY - rect.top;

    let xMm = pxToMm(xPx / this.zoom);
    let yMm = pxToMm(yPx / this.zoom);

    if (this.snapSettings.snapToGrid) {
      xMm = snapToGrid(xMm, this.gridSizeMm);
      yMm = snapToGrid(yMm, this.gridSizeMm);
    }

    const shapeType = event.dataTransfer?.getData('shape-type') || undefined;

    this.ngZone.run(() => {
      const overrides = shapeType ? { shapeType } : undefined;
      const newElement = createElement(elementType as any, { x: xMm, y: yMm }, overrides);
      this.templateState.addElement(section as any, newElement);
      this.selectionService.select(newElement.id, section);
      this.cdr.markForCheck();
    });
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  // ─── Zoom controls ───

  zoomIn(): void {
    this.zoom = Math.min(Math.round((this.zoom + 0.1) * 100) / 100, this.ZOOM_MAX);
  }

  zoomOut(): void {
    this.zoom = Math.max(Math.round((this.zoom - 0.1) * 100) / 100, this.ZOOM_MIN);
  }

  resetZoom(): void {
    this.zoom = 1;
  }

  /**
   * Wheel zoom: Ctrl+wheel or pinch-to-zoom on trackpad.
   * Zooms centered on the cursor position so the point under the cursor stays fixed.
   */
  private onWheel(e: WheelEvent): void {
    // Only zoom when Ctrl/Meta is held (browser sends ctrlKey=true for pinch gestures too)
    if (!e.ctrlKey && !e.metaKey) return;

    e.preventDefault();
    e.stopPropagation();

    const el = this.scrollArea.nativeElement;
    const rect = el.getBoundingClientRect();

    // Cursor position relative to the scroll container viewport
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;

    // Cursor position in the content (accounting for current scroll + zoom)
    const contentX = (el.scrollLeft + cursorX);
    const contentY = (el.scrollTop + cursorY);

    // Calculate new zoom
    const oldZoom = this.zoom;
    const delta = -e.deltaY * this.ZOOM_STEP * 0.1; // smooth small increments
    let newZoom = oldZoom + delta;
    newZoom = Math.max(this.ZOOM_MIN, Math.min(this.ZOOM_MAX, newZoom));
    newZoom = Math.round(newZoom * 100) / 100;

    if (newZoom === oldZoom) return;

    const scale = newZoom / oldZoom;

    // Apply zoom
    this.zoom = newZoom;
    this.cdr.markForCheck();

    // Adjust scroll so the point under the cursor stays in the same viewport position
    // After zoom, the content point that was at contentX,contentY is now at contentX*scale, contentY*scale
    requestAnimationFrame(() => {
      el.scrollLeft = contentX * scale - cursorX;
      el.scrollTop = contentY * scale - cursorY;
    });
  }

  toggleGrid(): void {
    this.showGrid = !this.showGrid;
  }

  // ─── Paper size ───

  onPaperTypeChange(): void {
    if (this.selectedPaperType === 'custom') {
      this.templateState.updatePaperSize('custom', this.customWidth, this.customHeight);
    } else {
      this.templateState.updatePaperSize(this.selectedPaperType);
    }
  }

  onCustomDimensionChange(): void {
    if (this.selectedPaperType !== 'custom') return;
    if (this.customWidth < 20) this.customWidth = 20;
    if (this.customHeight < 20) this.customHeight = 20;
    this.templateState.updatePaperSize('custom', this.customWidth, this.customHeight);
  }
}
