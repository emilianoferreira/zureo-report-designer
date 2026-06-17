import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, firstValueFrom, of } from 'rxjs';
import { LabelTemplate } from '../../../core/models/price-label-template.model';

const STORAGE_KEY = 'zureo_price_label_templates';
const DEFAULT_COMPANY_ID = 'c1000000-0000-0000-0000-000000000001';

@Injectable({
  providedIn: 'root'
})
export class PriceLabelStorageService {
  private templatesSubject = new BehaviorSubject<LabelTemplate[]>([]);
  readonly templates$: Observable<LabelTemplate[]> = this.templatesSubject.asObservable();

  private useApi = false;
  private companyId = DEFAULT_COMPANY_ID;

  constructor(private http: HttpClient) {
    this.init();
  }

  private async init(): Promise<void> {
    try {
      const apiRows = await firstValueFrom(
        this.http.get<any[]>(`/api/templates?companyId=${this.companyId}`).pipe(
          catchError(() => of(null))
        )
      );

      if (apiRows !== null) {
        this.useApi = true;
        this.templatesSubject.next(
          apiRows
            .filter(row => row?.template_json?.type === 'price-label')
            .map(row => this.apiToTemplate(row))
        );
        return;
      }
    } catch {}

    this.useApi = false;
    this.templatesSubject.next(this.loadLocal());
  }

  getAll(): LabelTemplate[] {
    return this.templatesSubject.getValue();
  }

  getById(id: string): LabelTemplate | undefined {
    return this.getAll().find(template => template.id === id);
  }

  async save(template: LabelTemplate): Promise<LabelTemplate> {
    if (this.useApi) {
      const existing = this.getById(template.id);
      if (existing) {
        const row = await firstValueFrom(
          this.http.put<any>(`/api/templates/${template.id}/design`, {
            template_json: template
          })
        );
        const saved = this.apiToTemplate(row);
        this.replace(saved);
        return saved;
      }

      const row = await firstValueFrom(
        this.http.post<any>('/api/templates', {
          nombre: template.name,
          company_id: this.companyId,
          descripcion: 'Molde de etiqueta de precios',
          template_json: template
        })
      );
      const created = this.apiToTemplate(row);
      this.templatesSubject.next([created, ...this.getAll()]);
      return created;
    }

    const all = this.getAll();
    const exists = all.some(item => item.id === template.id);
    const next = exists
      ? all.map(item => item.id === template.id ? template : item)
      : [template, ...all];
    this.persistLocal(next);
    return template;
  }

  async delete(id: string): Promise<void> {
    if (this.useApi) {
      await firstValueFrom(this.http.delete(`/api/templates/${id}`));
    }
    this.persistLocal(this.getAll().filter(template => template.id !== id));
  }

  private apiToTemplate(row: any): LabelTemplate {
    return {
      ...row.template_json,
      id: row.id,
      name: row.nombre || row.template_json?.name || 'Etiqueta sin nombre'
    };
  }

  private replace(template: LabelTemplate): void {
    this.templatesSubject.next(
      this.getAll().map(item => item.id === template.id ? template : item)
    );
  }

  private loadLocal(): LabelTemplate[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      return (JSON.parse(raw) as LabelTemplate[])
        .filter(template => template.type === 'price-label');
    } catch {
      return [];
    }
  }

  private persistLocal(templates: LabelTemplate[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
    this.templatesSubject.next(templates);
  }
}
