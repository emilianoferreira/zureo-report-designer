/**
 * Template Storage Service
 * Persists template molds using the REST API backend.
 * Falls back to localStorage if the API is not available.
 */

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, firstValueFrom, catchError, of } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { TemplateMold, CompanyDocumentType, ReportTemplate } from '../../../core/models/template.model';
import { createDefaultTemplate } from '../data/default-template';

const STORAGE_KEY = 'zureo_template_molds';

@Injectable({
  providedIn: 'root'
})
export class TemplateStorageService {

  private moldsSubject = new BehaviorSubject<TemplateMold[]>([]);
  public molds$: Observable<TemplateMold[]> = this.moldsSubject.asObservable();

  private useApi = false;
  private companyId = 'c1000000-0000-0000-0000-000000000001';

  constructor(private http: HttpClient) {
    this.init();
  }

  /** Initialize: try API first, fall back to localStorage */
  private async init(): Promise<void> {
    try {
      const apiMolds = await firstValueFrom(
        this.http.get<any[]>(`/api/templates?companyId=${this.companyId}`).pipe(
          catchError(() => of(null))
        )
      );

      if (apiMolds !== null) {
        this.useApi = true;
        const molds = apiMolds
          .filter(t => t?.template_json?.type !== 'price-label')
          .map(t => this.apiToMold(t));
        this.moldsSubject.next(molds);
        console.log(`[TemplateStorage] API mode (${molds.length} templates)`);
        return;
      }
    } catch {}

    // Fallback to localStorage
    this.useApi = false;
    this.moldsSubject.next(this.loadFromLocalStorage());
    console.log('[TemplateStorage] localStorage mode (API not available)');
  }

  // ─── Read ───

  getAll(): TemplateMold[] {
    return this.moldsSubject.getValue();
  }

  getById(id: string): TemplateMold | undefined {
    return this.getAll().find(m => m.id === id);
  }

  // ─── Create ───

  async create(
    name: string,
    documentType: CompanyDocumentType,
    description: string = '',
    companyId: string = 'default'
  ): Promise<TemplateMold> {
    const template = createDefaultTemplate();
    template.metadata.name = name;
    template.metadata.companyId = companyId;

    if (this.useApi) {
      const apiResult = await firstValueFrom(
        this.http.post<any>('/api/templates', {
          nombre: name,
          company_id: this.companyId,
          descripcion: description,
          template_json: {
            documentType,
            template,
          },
        })
      );
      const mold = this.apiToMold(apiResult);
      this.moldsSubject.next([...this.getAll(), mold]);
      return mold;
    }

    // localStorage fallback
    const now = new Date().toISOString();
    const mold: TemplateMold = {
      id: uuidv4(),
      name,
      documentType,
      description,
      companyId,
      createdAt: now,
      updatedAt: now,
      template
    };
    const molds = [...this.getAll(), mold];
    this.persistLocal(molds);
    return mold;
  }

  // ─── Update ───

  async updateMetadata(
    id: string,
    changes: Partial<Pick<TemplateMold, 'name' | 'description' | 'documentType'>>
  ): Promise<TemplateMold | undefined> {
    if (this.useApi) {
      const mold = this.getById(id);
      if (!mold) return undefined;

      const apiResult = await firstValueFrom(
        this.http.put<any>(`/api/templates/${id}`, {
          nombre: changes.name || mold.name,
          descripcion: changes.description ?? mold.description,
        })
      );
      const updated = this.apiToMold(apiResult);
      this.replaceInSubject(id, updated);
      return updated;
    }

    // localStorage fallback
    const molds = this.getAll();
    const index = molds.findIndex(m => m.id === id);
    if (index === -1) return undefined;

    const updated: TemplateMold = {
      ...molds[index],
      ...changes,
      updatedAt: new Date().toISOString()
    };

    if (changes.name) {
      updated.template = {
        ...updated.template,
        metadata: { ...updated.template.metadata, name: changes.name }
      };
    }

    molds[index] = updated;
    this.persistLocal([...molds]);
    return updated;
  }

  async saveTemplate(id: string, template: ReportTemplate): Promise<TemplateMold | undefined> {
    if (this.useApi) {
      const mold = this.getById(id);
      if (!mold) return undefined;

      const apiResult = await firstValueFrom(
        this.http.put<any>(`/api/templates/${id}/design`, {
          template_json: {
            documentType: mold.documentType,
            template,
          },
        })
      );
      const updated = this.apiToMold(apiResult);
      this.replaceInSubject(id, updated);
      return updated;
    }

    // localStorage fallback
    const molds = this.getAll();
    const index = molds.findIndex(m => m.id === id);
    if (index === -1) return undefined;

    const updated: TemplateMold = {
      ...molds[index],
      template: { ...template },
      updatedAt: new Date().toISOString()
    };
    molds[index] = updated;
    this.persistLocal([...molds]);
    return updated;
  }

  // ─── Delete ───

  async delete(id: string): Promise<boolean> {
    if (this.useApi) {
      try {
        await firstValueFrom(this.http.delete(`/api/templates/${id}`));
        this.moldsSubject.next(this.getAll().filter(m => m.id !== id));
        return true;
      } catch {
        return false;
      }
    }

    const molds = this.getAll();
    const filtered = molds.filter(m => m.id !== id);
    if (filtered.length === molds.length) return false;
    this.persistLocal(filtered);
    return true;
  }

  // ─── Duplicate ───

  async duplicate(id: string): Promise<TemplateMold | undefined> {
    if (this.useApi) {
      try {
        const apiResult = await firstValueFrom(
          this.http.post<any>(`/api/templates/${id}/duplicate`, {})
        );
        const mold = this.apiToMold(apiResult);
        this.moldsSubject.next([...this.getAll(), mold]);
        return mold;
      } catch {
        return undefined;
      }
    }

    // localStorage fallback
    const original = this.getById(id);
    if (!original) return undefined;

    const now = new Date().toISOString();
    const cloned: TemplateMold = {
      ...JSON.parse(JSON.stringify(original)),
      id: uuidv4(),
      name: `${original.name} (copia)`,
      createdAt: now,
      updatedAt: now
    };
    cloned.template.metadata.id = cloned.id;
    cloned.template.metadata.name = cloned.name;

    const molds = [...this.getAll(), cloned];
    this.persistLocal(molds);
    return cloned;
  }

  // ─── Helpers ───

  /** Convert API response to TemplateMold */
  private apiToMold(apiRow: any): TemplateMold {
    const json = apiRow.template_json || {};
    return {
      id: apiRow.id,
      name: apiRow.nombre || json.template?.metadata?.name || 'Sin nombre',
      documentType: json.documentType || 'venta_contado',
      description: apiRow.descripcion || '',
      companyId: apiRow.company_id || this.companyId,
      createdAt: apiRow.created_at,
      updatedAt: apiRow.updated_at,
      template: json.template || createDefaultTemplate(),
    };
  }

  private replaceInSubject(id: string, updated: TemplateMold): void {
    const molds = this.getAll().map(m => m.id === id ? updated : m);
    this.moldsSubject.next(molds);
  }

  private loadFromLocalStorage(): TemplateMold[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      return JSON.parse(raw) as TemplateMold[];
    } catch {
      console.error('Failed to load molds from localStorage');
      return [];
    }
  }

  private persistLocal(molds: TemplateMold[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(molds));
      this.moldsSubject.next(molds);
    } catch (e) {
      console.error('Failed to save molds to localStorage', e);
    }
  }
}
