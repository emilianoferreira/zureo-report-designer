import { v4 as uuid } from 'uuid';
import {
  LabelElement,
  LabelElementType,
  LabelFontStyle,
  LabelImageElement,
  LabelPoint,
  LabelSize
} from '../../../core/models/price-label-template.model';

const DEFAULT_FONT: LabelFontStyle = {
  family: 'Arial',
  size: 9,
  weight: 'normal',
  style: 'normal',
  color: '#111111'
};

export function createLabelElement(
  type: LabelElementType,
  position: LabelPoint,
  overrides: Partial<LabelElement> = {}
): LabelElement {
  const common = {
    id: uuid(),
    name: defaultName(type),
    position,
    style: {},
    locked: false,
    zIndex: 1,
    ...overrides
  };

  switch (type) {
    case 'text':
      return {
        ...common,
        type: 'text',
        name: overrides.name || 'Nombre articulo',
        size: mergeSize({ width: 34, height: 7 }, overrides.size),
        style: {
          font: { ...DEFAULT_FONT, weight: 'bold' },
          textAlign: 'left',
          verticalAlign: 'middle',
          ...overrides.style
        },
        content: '',
        binding: 'article.name'
      };
    case 'price':
      return {
        ...common,
        type: 'price',
        name: overrides.name || 'Precio',
        size: mergeSize({ width: 40, height: 8 }, overrides.size),
        style: {
          font: { ...DEFAULT_FONT, size: 16, weight: 'bold' },
          textAlign: 'center',
          verticalAlign: 'middle',
          ...overrides.style
        },
        binding: 'article.price',
        currencyPath: 'company.currencySymbol',
        prefix: '',
        decimals: 2
      };
    case 'barcode':
      return {
        ...common,
        type: 'barcode',
        name: overrides.name || 'Codigo de barras',
        size: mergeSize({ width: 36, height: 9 }, overrides.size),
        binding: 'article.barcode',
        barcodeType: 'CODE128',
        showText: true
      };
    case 'image':
      return {
        ...common,
        type: 'image',
        name: overrides.name || 'Logo empresa',
        size: mergeSize({ width: 14, height: 10 }, overrides.size),
        sourceType: 'binding',
        binding: 'company.logo',
        fit: 'contain'
      } as LabelImageElement;
    default:
      throw new Error(`Unknown label element type: ${type}`);
  }
}

export function cloneLabelElement(element: LabelElement): LabelElement {
  const cloned = JSON.parse(JSON.stringify(element)) as LabelElement;
  cloned.id = uuid();
  cloned.name = `${cloned.name} copia`;
  cloned.position = {
    x: cloned.position.x + 2,
    y: cloned.position.y + 2
  };
  return cloned;
}

function mergeSize(defaultSize: LabelSize, override?: LabelSize): LabelSize {
  return { ...defaultSize, ...(override || {}) };
}

function defaultName(type: LabelElementType): string {
  const names: Record<LabelElementType, string> = {
    text: 'Texto',
    price: 'Precio',
    barcode: 'Codigo de barras',
    image: 'Imagen'
  };
  return names[type];
}
