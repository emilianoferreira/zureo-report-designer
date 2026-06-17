import { Injectable } from '@angular/core';
import JsBarcode from 'jsbarcode';
import {
  LabelBarcodeElement,
  LabelElement,
  LabelImageElement,
  LabelPriceElement,
  LabelTemplate,
  LabelTextElement,
  PriceLabelArticle,
  PriceLabelCompany,
  PriceLabelRenderContext
} from '../../../core/models/price-label-template.model';

@Injectable({
  providedIn: 'root'
})
export class PriceLabelRendererService {
  renderToHtml(
    template: LabelTemplate,
    articles: PriceLabelArticle[],
    copies: number,
    company: PriceLabelCompany = { name: '', logo: '', currencySymbol: '$' }
  ): string {
    const page = template.page;
    const label = template.label;
    const safeCopies = Math.max(1, Math.round(copies || 1));
    const contexts = this.expandContexts(articles, safeCopies, company);

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${this.escapeHtml(template.name)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #f0f0f0; font-family: Arial, sans-serif; }
    .page {
      width: ${page.width}mm;
      min-height: ${page.height}mm;
      margin: 0 auto;
      padding: ${page.marginTop}mm ${page.marginRight}mm ${page.marginBottom}mm ${page.marginLeft}mm;
      background: #fff;
    }
    .labels-grid {
      display: grid;
      grid-template-columns: repeat(${label.columns}, ${label.width}mm);
      grid-auto-rows: ${label.height}mm;
      gap: ${label.gapY}mm ${label.gapX}mm;
      align-content: start;
      justify-content: start;
    }
    .label-cell {
      position: relative;
      width: ${label.width}mm;
      height: ${label.height}mm;
      overflow: hidden;
      background: #fff;
      break-inside: avoid;
    }
    .label-element {
      position: absolute;
      overflow: hidden;
    }
    .label-text, .label-price {
      line-height: 1.15;
      white-space: normal;
      word-break: break-word;
    }
    .label-image img {
      width: 100%;
      height: 100%;
      display: block;
    }
    .label-barcode svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    @page {
      size: ${page.width}mm ${page.height}mm;
      margin: 0;
    }
    @media print {
      html, body { background: #fff; }
      .page { margin: 0; min-height: ${page.height}mm; }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="labels-grid">
${contexts.map(context => this.renderLabel(template, context)).join('')}
    </section>
  </main>
</body>
</html>`;
  }

  renderLabel(template: LabelTemplate, context: PriceLabelRenderContext): string {
    const elements = [...template.elements].sort((a, b) => a.zIndex - b.zIndex);
    return `      <div class="label-cell">
${elements.map(element => this.renderElement(element, context)).join('')}      </div>
`;
  }

  resolvePath(path: string | undefined, context: PriceLabelRenderContext): any {
    if (!path) return undefined;
    const parts = path.split('.');
    let current: any = context;
    for (const part of parts) {
      if (current == null) return undefined;
      current = current[part];
    }
    return current;
  }

  formatPrice(value: any, decimals: number): string {
    const amount = Number(value);
    if (Number.isNaN(amount)) return '';
    return amount.toLocaleString('es-UY', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  private expandContexts(
    articles: PriceLabelArticle[],
    copies: number,
    company: PriceLabelCompany
  ): PriceLabelRenderContext[] {
    const contexts: PriceLabelRenderContext[] = [];
    for (const article of articles) {
      for (let index = 0; index < copies; index++) {
        contexts.push({ article, company });
      }
    }
    return contexts;
  }

  private renderElement(element: LabelElement, context: PriceLabelRenderContext): string {
    const style = this.getElementStyle(element);
    switch (element.type) {
      case 'text':
        return this.renderText(element, context, style);
      case 'price':
        return this.renderPrice(element, context, style);
      case 'barcode':
        return this.renderBarcode(element, context, style);
      case 'image':
        return this.renderImage(element, context, style);
      default:
        return '';
    }
  }

  private renderText(element: LabelTextElement, context: PriceLabelRenderContext, style: string): string {
    const value = element.binding
      ? this.resolvePath(element.binding, context)
      : element.content;
    return `        <div class="label-element label-text" style="${style}">${this.escapeHtml(String(value ?? ''))}</div>
`;
  }

  private renderPrice(element: LabelPriceElement, context: PriceLabelRenderContext, style: string): string {
    const value = this.resolvePath(element.binding, context);
    const symbol = element.currencyPath
      ? String(this.resolvePath(element.currencyPath, context) ?? '')
      : '';
    const prefix = element.prefix ?? '';
    const formatted = `${prefix}${symbol} ${this.formatPrice(value, element.decimals)}`.trim();
    return `        <div class="label-element label-price" style="${style}">${this.escapeHtml(formatted)}</div>
`;
  }

  private renderBarcode(element: LabelBarcodeElement, context: PriceLabelRenderContext, style: string): string {
    const value = String(this.resolvePath(element.binding, context) ?? '');
    const svg = this.generateBarcodeSvg(value, element);
    return `        <div class="label-element label-barcode" style="${style}">${svg}</div>
`;
  }

  private renderImage(element: LabelImageElement, context: PriceLabelRenderContext, style: string): string {
    const src = element.sourceType === 'binding'
      ? String(this.resolvePath(element.binding, context) ?? '')
      : (element.url || '');
    const fit = element.fit === 'stretch' ? 'fill' : element.fit;
    if (!src) {
      return `        <div class="label-element label-image" style="${style}"></div>
`;
    }
    return `        <div class="label-element label-image" style="${style}"><img src="${this.escapeHtml(src)}" style="object-fit:${fit};" /></div>
`;
  }

  private getElementStyle(element: LabelElement): string {
    const style = element.style || {};
    const font = style.font;
    const css: string[] = [
      `left:${element.position.x}mm`,
      `top:${element.position.y}mm`,
      `width:${element.size.width}mm`,
      `height:${element.size.height}mm`,
      `z-index:${element.zIndex}`,
      `opacity:${style.opacity ?? 1}`
    ];

    if (font) {
      css.push(`font-family:${font.family}, sans-serif`);
      css.push(`font-size:${font.size}pt`);
      css.push(`font-weight:${font.weight}`);
      css.push(`font-style:${font.style}`);
      css.push(`color:${font.color}`);
    }
    if (style.textAlign) css.push(`text-align:${style.textAlign}`);
    if (style.backgroundColor) css.push(`background-color:${style.backgroundColor}`);
    if (style.borderColor && style.borderWidth) {
      css.push(`border:${style.borderWidth}mm ${style.borderStyle || 'solid'} ${style.borderColor}`);
    }
    if (style.borderRadius) css.push(`border-radius:${style.borderRadius}mm`);
    if (style.verticalAlign) {
      const align = style.verticalAlign === 'middle'
        ? 'center'
        : style.verticalAlign === 'bottom'
          ? 'flex-end'
          : 'flex-start';
      css.push('display:flex');
      css.push(`align-items:${align}`);
      css.push(style.textAlign === 'center' ? 'justify-content:center' : '');
      css.push(style.textAlign === 'right' ? 'justify-content:flex-end' : '');
    }

    return css.filter(Boolean).join(';');
  }

  private generateBarcodeSvg(value: string, element: LabelBarcodeElement): string {
    if (!value) return '';
    try {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      (JsBarcode as any)(svg, value, {
        format: element.barcodeType || 'CODE128',
        displayValue: element.showText,
        margin: 0,
        width: 1.4,
        height: 34,
        fontSize: 8,
        background: '#ffffff',
        lineColor: '#111111'
      });
      return svg.outerHTML;
    } catch {
      return `<div style="font-size:8px;text-align:center;color:#999;">${this.escapeHtml(value)}</div>`;
    }
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
