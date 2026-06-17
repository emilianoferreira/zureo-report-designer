import { v4 as uuid } from 'uuid';
import { LabelTemplate } from '../../../core/models/price-label-template.model';

export function createDefaultPriceLabelTemplate(): LabelTemplate {
  return {
    id: uuid(),
    name: 'Etiqueta chica con codigo de barras',
    type: 'price-label',
    version: 1,
    unit: 'mm',
    page: {
      mode: 'sheet',
      size: 'A4',
      width: 210,
      height: 297,
      orientation: 'portrait',
      marginTop: 5,
      marginRight: 5,
      marginBottom: 5,
      marginLeft: 5
    },
    label: {
      width: 50,
      height: 30,
      columns: 4,
      rows: 8,
      gapX: 2,
      gapY: 2,
      paddingTop: 2,
      paddingRight: 2,
      paddingBottom: 2,
      paddingLeft: 2
    },
    elements: [
      {
        id: uuid(),
        type: 'image',
        name: 'Logo empresa',
        position: { x: 2, y: 2 },
        size: { width: 12, height: 8 },
        style: {},
        locked: false,
        zIndex: 1,
        sourceType: 'binding',
        binding: 'company.logo',
        fit: 'contain'
      },
      {
        id: uuid(),
        type: 'text',
        name: 'Nombre articulo',
        position: { x: 15, y: 2 },
        size: { width: 33, height: 8 },
        style: {
          font: { family: 'Arial', size: 8, weight: 'bold', style: 'normal', color: '#111111' },
          textAlign: 'left',
          verticalAlign: 'middle'
        },
        locked: false,
        zIndex: 2,
        content: '',
        binding: 'article.name'
      },
      {
        id: uuid(),
        type: 'price',
        name: 'Precio',
        position: { x: 2, y: 11 },
        size: { width: 46, height: 8 },
        style: {
          font: { family: 'Arial', size: 17, weight: 'bold', style: 'normal', color: '#111111' },
          textAlign: 'center',
          verticalAlign: 'middle'
        },
        locked: false,
        zIndex: 3,
        binding: 'article.price',
        currencyPath: 'company.currencySymbol',
        prefix: '',
        decimals: 2
      },
      {
        id: uuid(),
        type: 'barcode',
        name: 'Codigo de barras',
        position: { x: 7, y: 20 },
        size: { width: 36, height: 8 },
        style: {},
        locked: false,
        zIndex: 2,
        binding: 'article.barcode',
        barcodeType: 'CODE128',
        showText: true
      }
    ]
  };
}
