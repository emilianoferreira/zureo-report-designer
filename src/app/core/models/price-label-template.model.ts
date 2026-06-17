/**
 * Price label template model.
 * All persisted measurements are millimeters. Screen pixels are only used by
 * components while rendering or handling pointer movement.
 */

export type LabelTemplateType = 'price-label';
export type LabelUnit = 'mm';
export type LabelPageMode = 'sheet' | 'continuous';
export type LabelPageSize = 'A4' | 'custom';
export type LabelOrientation = 'portrait' | 'landscape';
export type LabelElementType = 'text' | 'price' | 'barcode' | 'image';

export interface LabelTemplate {
  id: string;
  name: string;
  type: LabelTemplateType;
  version: number;
  unit: LabelUnit;
  page: LabelPageConfig;
  label: LabelConfig;
  elements: LabelElement[];
}

export interface LabelPageConfig {
  mode: LabelPageMode;
  size: LabelPageSize;
  width: number;
  height: number;
  orientation: LabelOrientation;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
}

export interface LabelConfig {
  width: number;
  height: number;
  columns: number;
  rows: number;
  gapX: number;
  gapY: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
}

export interface LabelPoint {
  x: number;
  y: number;
}

export interface LabelSize {
  width: number;
  height: number;
}

export interface LabelFontStyle {
  family: string;
  size: number;
  weight: 'normal' | 'bold';
  style: 'normal' | 'italic';
  color: string;
}

export interface LabelElementStyle {
  font?: LabelFontStyle;
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  borderRadius?: number;
  opacity?: number;
}

export interface BaseLabelElement {
  id: string;
  type: LabelElementType;
  name: string;
  position: LabelPoint;
  size: LabelSize;
  style: LabelElementStyle;
  locked: boolean;
  zIndex: number;
}

export interface LabelTextElement extends BaseLabelElement {
  type: 'text';
  content: string;
  binding?: string;
}

export interface LabelPriceElement extends BaseLabelElement {
  type: 'price';
  binding: string;
  currencyPath?: string;
  prefix?: string;
  decimals: number;
}

export interface LabelBarcodeElement extends BaseLabelElement {
  type: 'barcode';
  binding: string;
  barcodeType: 'CODE128' | 'EAN13' | 'EAN8' | 'CODE39';
  showText: boolean;
}

export interface LabelImageElement extends BaseLabelElement {
  type: 'image';
  sourceType: 'binding' | 'url';
  binding?: string;
  url?: string;
  fit: 'contain' | 'cover' | 'stretch';
}

export type LabelElement =
  | LabelTextElement
  | LabelPriceElement
  | LabelBarcodeElement
  | LabelImageElement;

export interface PriceLabelArticle {
  id: string;
  name: string;
  price: number;
  barcode: string;
  [key: string]: any;
}

export interface PriceLabelCompany {
  name: string;
  logo: string;
  currencySymbol: string;
  [key: string]: any;
}

export interface PriceLabelRenderContext {
  article: PriceLabelArticle;
  company: PriceLabelCompany;
}

export interface PriceLabelRenderRequest {
  template: LabelTemplate;
  articles: PriceLabelArticle[];
  company: PriceLabelCompany;
  copies: number;
}
