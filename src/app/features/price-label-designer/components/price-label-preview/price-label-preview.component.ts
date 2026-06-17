import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LabelTemplate,
  PriceLabelArticle,
  PriceLabelCompany
} from '../../../../core/models/price-label-template.model';
import { mmToPx } from '../../../template-designer/utils/coordinate-utils';
import { PriceLabelRendererService } from '../../services/price-label-renderer.service';

type PreviewMode = 'sheet' | 'html' | 'json';

@Component({
  selector: 'app-price-label-preview',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './price-label-preview.component.html',
  styleUrl: './price-label-preview.component.scss'
})
export class PriceLabelPreviewComponent implements OnChanges, AfterViewInit {
  @ViewChild('previewFrame') previewFrame!: ElementRef<HTMLIFrameElement>;

  @Input({ required: true }) template!: LabelTemplate;
  @Input({ required: true }) articles!: PriceLabelArticle[];
  @Input({ required: true }) company!: PriceLabelCompany;

  copies = 1;
  mode: PreviewMode = 'sheet';
  html = '';
  json = '';
  zoom = 0.72;

  constructor(private renderer: PriceLabelRendererService) {}

  ngAfterViewInit(): void {
    this.render();
  }

  ngOnChanges(_changes: SimpleChanges): void {
    this.render();
  }

  get pageWidthPx(): number {
    return mmToPx(this.template.page.width);
  }

  get pageHeightPx(): number {
    return mmToPx(this.template.page.height);
  }

  setMode(mode: PreviewMode): void {
    this.mode = mode;
    if (mode === 'sheet') {
      this.injectIframe();
    }
  }

  onCopiesChange(): void {
    this.copies = Math.max(1, Math.round(this.copies || 1));
    this.render();
  }

  print(): void {
    this.previewFrame?.nativeElement.contentWindow?.print();
  }

  exportHtml(): void {
    this.download(this.html, this.safeFileName('html'), 'text/html');
  }

  exportJson(): void {
    this.download(this.json, this.safeFileName('json'), 'application/json');
  }

  private render(): void {
    if (!this.template || !this.articles || !this.company) return;
    this.html = this.renderer.renderToHtml(this.template, this.articles, this.copies, this.company);
    this.json = JSON.stringify(this.template, null, 2);
    if (this.mode === 'sheet') {
      this.injectIframe();
    }
  }

  private injectIframe(): void {
    setTimeout(() => {
      const doc = this.previewFrame?.nativeElement.contentDocument;
      if (!doc) return;
      doc.open();
      doc.write(this.html);
      doc.close();
    });
  }

  private safeFileName(ext: string): string {
    const name = this.template.name || 'price-label-template';
    return `${name.replace(/[^a-z0-9_-]+/gi, '_')}.${ext}`;
  }

  private download(content: string, filename: string, type: string): void {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}
