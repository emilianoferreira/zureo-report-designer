import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  LabelElement,
  LabelElementType,
  LabelTemplate
} from '../../../../core/models/price-label-template.model';
import { PriceLabelCanvasComponent } from '../price-label-canvas/price-label-canvas.component';
import { PriceLabelPreviewComponent } from '../price-label-preview/price-label-preview.component';
import { PriceLabelPropertiesComponent } from '../price-label-properties/price-label-properties.component';
import {
  SAMPLE_PRICE_LABEL_ARTICLES,
  SAMPLE_PRICE_LABEL_COMPANY
} from '../../data/sample-price-label-data';
import { createDefaultPriceLabelTemplate } from '../../data/default-price-label-template';
import { PriceLabelStateService } from '../../services/price-label-state.service';
import { PriceLabelStorageService } from '../../services/price-label-storage.service';

type ViewMode = 'design' | 'preview';

interface ToolItem {
  type: LabelElementType;
  label: string;
  description: string;
}

@Component({
  selector: 'app-price-label-designer',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PriceLabelCanvasComponent,
    PriceLabelPreviewComponent,
    PriceLabelPropertiesComponent
  ],
  templateUrl: './price-label-designer.component.html',
  styleUrl: './price-label-designer.component.scss'
})
export class PriceLabelDesignerComponent implements OnInit, OnDestroy {
  template = createDefaultPriceLabelTemplate();
  savedTemplates: LabelTemplate[] = [];
  selectedElementId: string | null = null;
  viewMode: ViewMode = 'design';
  saveStatus = '';

  readonly sampleArticles = SAMPLE_PRICE_LABEL_ARTICLES;
  readonly sampleCompany = SAMPLE_PRICE_LABEL_COMPANY;

  readonly tools: ToolItem[] = [
    { type: 'text', label: 'Nombre', description: 'Campo article.name' },
    { type: 'price', label: 'Precio', description: 'Campo article.price' },
    { type: 'barcode', label: 'Codigo', description: 'Campo article.barcode' },
    { type: 'image', label: 'Logo', description: 'Campo company.logo' }
  ];

  readonly labelPresets = [
    { id: '50x30', label: '50 x 30 mm', width: 50, height: 30, columns: 4, rows: 8 },
    { id: '60x40', label: '60 x 40 mm', width: 60, height: 40, columns: 3, rows: 6 },
    { id: '40x25', label: '40 x 25 mm', width: 40, height: 25, columns: 4, rows: 10 },
    { id: 'custom', label: 'Personalizado', width: 0, height: 0, columns: 0, rows: 0 }
  ];
  selectedPreset = '50x30';

  private sub = new Subscription();
  private saveStatusTimer: any;

  constructor(
    private state: PriceLabelStateService,
    private storage: PriceLabelStorageService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.sub.add(
      this.state.template$.subscribe(template => {
        this.template = template;
        this.selectedPreset = this.detectPreset(template);
        if (this.selectedElementId && !template.elements.some(el => el.id === this.selectedElementId)) {
          this.selectedElementId = null;
        }
      })
    );

    this.sub.add(
      this.storage.templates$.subscribe(templates => {
        this.savedTemplates = templates;
      })
    );
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
    if (this.saveStatusTimer) clearTimeout(this.saveStatusTimer);
  }

  get selectedElement(): LabelElement | null {
    if (!this.selectedElementId) return null;
    return this.template.elements.find(el => el.id === this.selectedElementId) || null;
  }

  goToDocuments(): void {
    this.router.navigate(['/templates']);
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
  }

  createNewTemplate(): void {
    this.selectedElementId = null;
    this.state.setTemplate(createDefaultPriceLabelTemplate());
  }

  openTemplate(templateId: string): void {
    const template = this.storage.getById(templateId);
    if (!template) return;
    this.selectedElementId = null;
    this.state.setTemplate(template);
  }

  async saveTemplate(): Promise<void> {
    const saved = await this.storage.save(this.template);
    this.state.setTemplate(saved);
    this.showSaveStatus('Guardado');
  }

  async deleteTemplate(): Promise<void> {
    if (this.storage.getById(this.template.id)) {
      await this.storage.delete(this.template.id);
    }
    this.createNewTemplate();
    this.showSaveStatus('Eliminado');
  }

  updateName(name: string): void {
    this.state.updateName(name.trim() || 'Etiqueta sin nombre');
  }

  onToolDragStart(event: DragEvent, tool: ToolItem): void {
    event.dataTransfer?.setData('label-element-type', tool.type);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy';
    }
  }

  onElementDropped(event: { type: LabelElementType; position: { x: number; y: number } }): void {
    const element = this.state.addElement(event.type, event.position);
    this.selectedElementId = element.id;
  }

  onElementChanged(event: { id: string; changes: Partial<LabelElement> }): void {
    this.state.updateElement(event.id, event.changes);
  }

  selectElement(id: string | null): void {
    this.selectedElementId = id;
  }

  deleteElement(id: string): void {
    this.state.removeElement(id);
    this.selectedElementId = null;
  }

  duplicateElement(id: string): void {
    const duplicated = this.state.duplicateElement(id);
    if (duplicated) this.selectedElementId = duplicated.id;
  }

  applyPreset(presetId: string): void {
    const preset = this.labelPresets.find(item => item.id === presetId);
    if (!preset || preset.id === 'custom') return;
    this.state.updateLabel({
      width: preset.width,
      height: preset.height,
      columns: preset.columns,
      rows: preset.rows
    });
  }

  updateLabelNumber(field: keyof LabelTemplate['label'], value: any): void {
    this.selectedPreset = 'custom';
    this.state.updateLabel({ [field]: Number(value) } as any);
  }

  updatePageNumber(field: keyof LabelTemplate['page'], value: any): void {
    this.state.updatePage({ [field]: Number(value) } as any);
  }

  private detectPreset(template: LabelTemplate): string {
    const match = this.labelPresets.find(preset =>
      preset.id !== 'custom' &&
      preset.width === template.label.width &&
      preset.height === template.label.height
    );
    return match?.id || 'custom';
  }

  private showSaveStatus(message: string): void {
    this.saveStatus = message;
    if (this.saveStatusTimer) clearTimeout(this.saveStatusTimer);
    this.saveStatusTimer = setTimeout(() => {
      this.saveStatus = '';
    }, 1800);
  }
}
