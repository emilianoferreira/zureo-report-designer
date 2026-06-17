import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import {
  LabelConfig,
  LabelElement,
  LabelElementType,
  LabelPageConfig,
  LabelPoint,
  LabelTemplate
} from '../../../core/models/price-label-template.model';
import { createDefaultPriceLabelTemplate } from '../data/default-price-label-template';
import { cloneLabelElement, createLabelElement } from '../utils/price-label-element-factory';

@Injectable({
  providedIn: 'root'
})
export class PriceLabelStateService {
  private templateSubject = new BehaviorSubject<LabelTemplate>(createDefaultPriceLabelTemplate());
  readonly template$: Observable<LabelTemplate> = this.templateSubject.asObservable();

  getCurrentTemplate(): LabelTemplate {
    return this.templateSubject.getValue();
  }

  setTemplate(template: LabelTemplate): void {
    this.templateSubject.next(JSON.parse(JSON.stringify(template)));
  }

  updateName(name: string): void {
    const current = this.getCurrentTemplate();
    this.setTemplate({ ...current, name, version: current.version + 1 });
  }

  updatePage(changes: Partial<LabelPageConfig>): void {
    const current = this.getCurrentTemplate();
    this.setTemplate({
      ...current,
      version: current.version + 1,
      page: { ...current.page, ...changes }
    });
  }

  updateLabel(changes: Partial<LabelConfig>): void {
    const current = this.getCurrentTemplate();
    const label = this.normalizeLabel({ ...current.label, ...changes });
    this.setTemplate({
      ...current,
      version: current.version + 1,
      label,
      elements: current.elements.map(el => this.clampElement(el, label))
    });
  }

  addElement(type: LabelElementType, position: LabelPoint): LabelElement {
    const current = this.getCurrentTemplate();
    const element = this.clampElement(createLabelElement(type, position), current.label);
    this.setTemplate({
      ...current,
      version: current.version + 1,
      elements: [...current.elements, element]
    });
    return element;
  }

  updateElement(elementId: string, changes: Partial<LabelElement>): void {
    const current = this.getCurrentTemplate();
    this.setTemplate({
      ...current,
      version: current.version + 1,
      elements: current.elements.map(el => {
        if (el.id !== elementId) return el;
        return this.clampElement({ ...el, ...changes } as LabelElement, current.label);
      })
    });
  }

  removeElement(elementId: string): void {
    const current = this.getCurrentTemplate();
    this.setTemplate({
      ...current,
      version: current.version + 1,
      elements: current.elements.filter(el => el.id !== elementId)
    });
  }

  duplicateElement(elementId: string): LabelElement | null {
    const current = this.getCurrentTemplate();
    const original = current.elements.find(el => el.id === elementId);
    if (!original) return null;

    const cloned = this.clampElement(cloneLabelElement(original), current.label);
    this.setTemplate({
      ...current,
      version: current.version + 1,
      elements: [...current.elements, cloned]
    });
    return cloned;
  }

  getElement(elementId: string | null): LabelElement | null {
    if (!elementId) return null;
    return this.getCurrentTemplate().elements.find(el => el.id === elementId) || null;
  }

  clampElement(element: LabelElement, label: LabelConfig): LabelElement {
    const width = Math.max(2, Math.min(element.size.width, label.width));
    const height = Math.max(2, Math.min(element.size.height, label.height));
    const maxX = Math.max(0, label.width - width);
    const maxY = Math.max(0, label.height - height);

    return {
      ...element,
      size: { width, height },
      position: {
        x: roundMm(Math.max(0, Math.min(element.position.x, maxX))),
        y: roundMm(Math.max(0, Math.min(element.position.y, maxY)))
      }
    };
  }

  private normalizeLabel(label: LabelConfig): LabelConfig {
    return {
      width: Math.max(10, roundMm(label.width)),
      height: Math.max(10, roundMm(label.height)),
      columns: Math.max(1, Math.round(label.columns)),
      rows: Math.max(1, Math.round(label.rows)),
      gapX: Math.max(0, roundMm(label.gapX)),
      gapY: Math.max(0, roundMm(label.gapY)),
      paddingTop: Math.max(0, roundMm(label.paddingTop)),
      paddingRight: Math.max(0, roundMm(label.paddingRight)),
      paddingBottom: Math.max(0, roundMm(label.paddingBottom)),
      paddingLeft: Math.max(0, roundMm(label.paddingLeft))
    };
  }
}

function roundMm(value: number): number {
  return Math.round(value * 10) / 10;
}
