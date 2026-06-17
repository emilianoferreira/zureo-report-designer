import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LabelBarcodeElement,
  LabelElement,
  LabelImageElement,
  LabelPriceElement,
  LabelTextElement
} from '../../../../core/models/price-label-template.model';

@Component({
  selector: 'app-price-label-properties',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './price-label-properties.component.html',
  styleUrl: './price-label-properties.component.scss'
})
export class PriceLabelPropertiesComponent implements OnChanges {
  @Input() element: LabelElement | null = null;

  @Output() elementChanged = new EventEmitter<{ id: string; changes: Partial<LabelElement> }>();
  @Output() deleteRequested = new EventEmitter<string>();
  @Output() duplicateRequested = new EventEmitter<string>();

  name = '';
  x = 0;
  y = 0;
  width = 0;
  height = 0;
  locked = false;
  zIndex = 1;

  fontFamily = 'Arial';
  fontSize = 9;
  fontWeight: 'normal' | 'bold' = 'normal';
  fontStyle: 'normal' | 'italic' = 'normal';
  fontColor = '#111111';
  textAlign: 'left' | 'center' | 'right' = 'left';
  verticalAlign: 'top' | 'middle' | 'bottom' = 'top';
  backgroundColor = '';
  borderColor = '';
  borderWidth = 0;
  borderStyle: 'solid' | 'dashed' | 'dotted' = 'solid';
  borderRadius = 0;
  opacity = 1;

  textContent = '';
  textBinding = 'article.name';
  priceBinding = 'article.price';
  priceCurrencyPath = 'company.currencySymbol';
  pricePrefix = '';
  priceDecimals = 2;
  barcodeBinding = 'article.barcode';
  barcodeType: 'CODE128' | 'EAN13' | 'EAN8' | 'CODE39' = 'CODE128';
  barcodeShowText = true;
  imageSourceType: 'binding' | 'url' = 'binding';
  imageBinding = 'company.logo';
  imageUrl = '';
  imageFit: 'contain' | 'cover' | 'stretch' = 'contain';

  readonly fontFamilies = ['Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Times New Roman', 'Courier New'];
  readonly barcodeTypes = ['CODE128', 'EAN13', 'EAN8', 'CODE39'];
  readonly dataPaths = [
    { path: 'article.name', label: 'Nombre del articulo' },
    { path: 'article.price', label: 'Precio' },
    { path: 'article.barcode', label: 'Codigo de barras' },
    { path: 'company.logo', label: 'Logo de empresa' },
    { path: 'company.currencySymbol', label: 'Simbolo de moneda' }
  ];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['element']) {
      this.loadElement();
    }
  }

  get elementTypeLabel(): string {
    if (!this.element) return '';
    const labels: Record<string, string> = {
      text: 'Texto / nombre',
      price: 'Precio',
      barcode: 'Codigo de barras',
      image: 'Imagen / logo'
    };
    return labels[this.element.type] || this.element.type;
  }

  get hasFont(): boolean {
    return this.element?.type === 'text' || this.element?.type === 'price';
  }

  applyChanges(): void {
    if (!this.element) return;

    const style: any = {
      ...this.element.style,
      textAlign: this.textAlign,
      verticalAlign: this.verticalAlign,
      backgroundColor: this.backgroundColor || undefined,
      borderColor: this.borderColor || undefined,
      borderWidth: this.borderWidth || undefined,
      borderStyle: this.borderStyle,
      borderRadius: this.borderRadius || undefined,
      opacity: this.opacity
    };

    if (this.hasFont) {
      style.font = {
        family: this.fontFamily,
        size: this.fontSize,
        weight: this.fontWeight,
        style: this.fontStyle,
        color: this.fontColor
      };
    }

    const changes: any = {
      name: this.name,
      position: { x: this.x, y: this.y },
      size: { width: this.width, height: this.height },
      locked: this.locked,
      zIndex: this.zIndex,
      style
    };

    if (this.element.type === 'text') {
      changes.content = this.textContent;
      changes.binding = this.textBinding || undefined;
    }
    if (this.element.type === 'price') {
      changes.binding = this.priceBinding;
      changes.currencyPath = this.priceCurrencyPath || undefined;
      changes.prefix = this.pricePrefix;
      changes.decimals = this.priceDecimals;
    }
    if (this.element.type === 'barcode') {
      changes.binding = this.barcodeBinding;
      changes.barcodeType = this.barcodeType;
      changes.showText = this.barcodeShowText;
    }
    if (this.element.type === 'image') {
      changes.sourceType = this.imageSourceType;
      changes.binding = this.imageBinding || undefined;
      changes.url = this.imageUrl || undefined;
      changes.fit = this.imageFit;
    }

    this.elementChanged.emit({ id: this.element.id, changes });
  }

  deleteElement(): void {
    if (this.element) this.deleteRequested.emit(this.element.id);
  }

  duplicateElement(): void {
    if (this.element) this.duplicateRequested.emit(this.element.id);
  }

  toggleBold(): void {
    this.fontWeight = this.fontWeight === 'bold' ? 'normal' : 'bold';
    this.applyChanges();
  }

  toggleItalic(): void {
    this.fontStyle = this.fontStyle === 'italic' ? 'normal' : 'italic';
    this.applyChanges();
  }

  private loadElement(): void {
    const element = this.element;
    if (!element) return;

    this.name = element.name;
    this.x = element.position.x;
    this.y = element.position.y;
    this.width = element.size.width;
    this.height = element.size.height;
    this.locked = element.locked;
    this.zIndex = element.zIndex;

    const style = element.style || {};
    const font = style.font;
    if (font) {
      this.fontFamily = font.family;
      this.fontSize = font.size;
      this.fontWeight = font.weight;
      this.fontStyle = font.style;
      this.fontColor = font.color;
    }
    this.textAlign = style.textAlign || 'left';
    this.verticalAlign = style.verticalAlign || 'top';
    this.backgroundColor = style.backgroundColor || '';
    this.borderColor = style.borderColor || '';
    this.borderWidth = style.borderWidth || 0;
    this.borderStyle = style.borderStyle || 'solid';
    this.borderRadius = style.borderRadius || 0;
    this.opacity = style.opacity ?? 1;

    if (element.type === 'text') {
      const text = element as LabelTextElement;
      this.textContent = text.content || '';
      this.textBinding = text.binding || '';
    }
    if (element.type === 'price') {
      const price = element as LabelPriceElement;
      this.priceBinding = price.binding;
      this.priceCurrencyPath = price.currencyPath || '';
      this.pricePrefix = price.prefix || '';
      this.priceDecimals = price.decimals;
    }
    if (element.type === 'barcode') {
      const barcode = element as LabelBarcodeElement;
      this.barcodeBinding = barcode.binding;
      this.barcodeType = barcode.barcodeType;
      this.barcodeShowText = barcode.showText;
    }
    if (element.type === 'image') {
      const image = element as LabelImageElement;
      this.imageSourceType = image.sourceType;
      this.imageBinding = image.binding || '';
      this.imageUrl = image.url || '';
      this.imageFit = image.fit;
    }
  }
}
