import { Injectable, NotFoundException } from '@nestjs/common';

export interface SupplierProduct {
  itemId: string;
  itemReference: string;
  itemName: string;
  description: string;
  unitPrice: number;
  currency: string;
  availableQuantity: number;
}

interface RetailerProductCatalog {
  retailerMerchantId: string;
  retailerName: string;
  supplierMerchantId: string;
  items: SupplierProduct[];
}

const MOCK_RETAILER_CATALOGS: RetailerProductCatalog[] = [
  {
    retailerMerchantId: 'pay_retailer_001',
    retailerName: 'Nairobi BuildMart - Westlands',
    supplierMerchantId: 'pay_supplier_cement_001',
    items: [
      {
        itemId: 'ITEM-CEMENT-001',
        itemReference: 'CEMENT-50KG-001',
        itemName: 'Bamburi Cement 50kg',
        description: 'Construction cement',
        unitPrice: 850,
        currency: 'KES',
        availableQuantity: 240,
      },
      {
        itemId: 'ITEM-CEMENT-002',
        itemReference: 'CEMENT-32KG-002',
        itemName: 'Bamburi Cement 32.5R 50kg',
        description: 'General building cement',
        unitPrice: 820,
        currency: 'KES',
        availableQuantity: 180,
      },
      {
        itemId: 'ITEM-CEMENT-003',
        itemReference: 'CEMENT-NDARUGO-003',
        itemName: 'Ndarugo Cement 50kg',
        description: 'Premium construction cement',
        unitPrice: 880,
        currency: 'KES',
        availableQuantity: 95,
      },
    ],
  },
  {
    retailerMerchantId: 'pay_retailer_001',
    retailerName: 'Nairobi BuildMart - Westlands',
    supplierMerchantId: 'pay_supplier_steel_002',
    items: [
      {
        itemId: 'ITEM-STEEL-001',
        itemReference: 'STEEL-BAR-12MM-001',
        itemName: 'Steel Reinforcement Bar 12mm',
        description: '12mm steel reinforcement bar',
        unitPrice: 1450,
        currency: 'KES',
        availableQuantity: 75,
      },
      {
        itemId: 'ITEM-STEEL-002',
        itemReference: 'STEEL-BAR-16MM-002',
        itemName: 'Steel Reinforcement Bar 16mm',
        description: '16mm steel reinforcement bar',
        unitPrice: 2150,
        currency: 'KES',
        availableQuantity: 55,
      },
    ],
  },
  {
    retailerMerchantId: 'pay_retailer_002',
    retailerName: 'Mombasa Trade Centre',
    supplierMerchantId: 'pay_supplier_cement_001',
    items: [
      {
        itemId: 'ITEM-CEMENT-004',
        itemReference: 'CEMENT-50KG-004',
        itemName: 'Bamburi Cement 50kg',
        description: 'Construction cement',
        unitPrice: 870,
        currency: 'KES',
        availableQuantity: 120,
      },
    ],
  },
];

@Injectable()
export class SupplierProductsService {
  getProductsBySupplier(supplierMerchantId: string) {
    const catalogs = this.findSupplierCatalogs(supplierMerchantId);

    return {
      success: true,
      supplierMerchantId,
      source: 'mock-retailer-connection',
      count: catalogs.reduce((count, catalog) => count + catalog.items.length, 0),
      retailers: catalogs.map((catalog) => ({
        retailerMerchantId: catalog.retailerMerchantId,
        retailerName: catalog.retailerName,
        connected: true,
        items: catalog.items,
      })),
    };
  }

  getSupplierProductsForRetailer(supplierMerchantId: string, retailerMerchantId: string) {
    const catalog = MOCK_RETAILER_CATALOGS.find(
      (entry) => entry.supplierMerchantId === supplierMerchantId && entry.retailerMerchantId === retailerMerchantId,
    );

    if (!catalog) {
      throw new NotFoundException({
        statusCode: 404,
        message: `No product connection found for supplier ${supplierMerchantId} and retailer ${retailerMerchantId}`,
        error: 'PRODUCT_CONNECTION_NOT_FOUND',
      });
    }

    return {
      success: true,
      supplierMerchantId,
      retailerMerchantId,
      retailerName: catalog.retailerName,
      connected: true,
      source: 'mock-retailer-connection',
      count: catalog.items.length,
      items: catalog.items,
    };
  }

  private findSupplierCatalogs(supplierMerchantId: string) {
    const catalogs = MOCK_RETAILER_CATALOGS.filter((entry) => entry.supplierMerchantId === supplierMerchantId);

    if (catalogs.length === 0) {
      throw new NotFoundException({
        statusCode: 404,
        message: `No products found for supplier ${supplierMerchantId}`,
        error: 'SUPPLIER_PRODUCTS_NOT_FOUND',
      });
    }

    return catalogs;
  }
}