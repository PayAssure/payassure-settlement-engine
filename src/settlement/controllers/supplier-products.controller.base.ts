import { ForbiddenException, Get, Param, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { SupplierSettlementControllerBase } from './supplier-settlement.controller.base';

export abstract class SupplierProductsControllerBase extends SupplierSettlementControllerBase {
  @Get('directory')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'List registered suppliers',
    description: 'Returns supplier business details, merchant IDs, integration status, and limited payout destination details. Payout identifiers are masked and API credentials are not returned. Administrators only.',
  })
  @ApiResponse({
    status: 200,
    description: 'Registered suppliers returned successfully.',
    schema: {
      example: {
        success: true,
        count: 1,
        suppliers: [{
          id: 'clx123supplier',
          merchantId: 'pay_supplier_001',
          businessName: 'Example Supplies Ltd',
          businessType: 'LIMITED_COMPANY',
          status: 'ACTIVE',
          integration: { environment: 'production', isActive: true },
          payment: {
            type: 'MPESA',
            accountName: 'Example Supplies',
            provider: 'Safaricom',
            status: 'VERIFIED',
            isVerified: true,
            phoneNumber: '****1234',
          },
        }],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Authentication token is missing or invalid.' })
  @ApiResponse({ status: 403, description: 'Only administrators can list registered suppliers.' })
  async getRegisteredSuppliers(@Req() req: { user?: { role?: string } }) {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(req.user?.role ?? '')) {
      throw new ForbiddenException('Only administrators can list registered suppliers');
    }

    return this.supplierDirectoryService.getRegisteredSuppliers();
  }

  @Get('products/:supplierMerchantId')
  @ApiParam({ name: 'supplierMerchantId', example: 'pay_supplier_cement_001', description: 'Supplier merchant ID from the supplier integration credentials.' })
  @ApiOperation({
    summary: 'Get products by supplier merchant ID',
    description: 'Returns item-only product data for the mock retailer connections currently available to the supplier. This is a read-only integration side feature and does not alter settlement or payment data.',
  })
  @ApiResponse({
    status: 200,
    description: 'Supplier products returned successfully.',
    schema: {
      example: {
        success: true,
        supplierMerchantId: 'pay_supplier_cement_001',
        source: 'mock-retailer-connection',
        count: 4,
        retailers: [{
          retailerMerchantId: 'pay_retailer_001',
          retailerName: 'Nairobi BuildMart - Westlands',
          connected: true,
          items: [{
            itemId: 'ITEM-CEMENT-001',
            itemReference: 'CEMENT-50KG-001',
            itemName: 'Bamburi Cement 50kg',
            description: 'Construction cement',
            unitPrice: 850,
            currency: 'KES',
            availableQuantity: 240,
          }],
        }],
      },
    },
  })
  @ApiResponse({ status: 404, description: 'No mock product catalog found for the supplier.' })
  async getProductsBySupplier(@Param('supplierMerchantId') supplierMerchantId: string) {
    return this.supplierProductsService.getProductsBySupplier(supplierMerchantId);
  }

  @Get('products/:supplierMerchantId/retailer/:retailerMerchantId')
  @ApiParam({ name: 'supplierMerchantId', example: 'pay_supplier_cement_001', description: 'Supplier merchant ID.' })
  @ApiParam({ name: 'retailerMerchantId', example: 'pay_retailer_001', description: 'Connected retailer merchant ID.' })
  @ApiOperation({
    summary: 'Get supplier products for a retailer',
    description: 'Returns only the items exposed by a connected mock retailer to the requested supplier. No payment status, settlement status, or retailer account data is returned.',
  })
  @ApiResponse({
    status: 200,
    description: 'Supplier products for the retailer returned successfully.',
    schema: {
      example: {
        success: true,
        supplierMerchantId: 'pay_supplier_cement_001',
        retailerMerchantId: 'pay_retailer_001',
        retailerName: 'Nairobi BuildMart - Westlands',
        connected: true,
        source: 'mock-retailer-connection',
        count: 3,
        items: [{
          itemId: 'ITEM-CEMENT-001',
          itemReference: 'CEMENT-50KG-001',
          itemName: 'Bamburi Cement 50kg',
          description: 'Construction cement',
          unitPrice: 850,
          currency: 'KES',
          availableQuantity: 240,
        }],
      },
    },
  })
  @ApiResponse({ status: 404, description: 'No product connection found for the supplier and retailer.' })
  async getSupplierProductsForRetailer(
    @Param('supplierMerchantId') supplierMerchantId: string,
    @Param('retailerMerchantId') retailerMerchantId: string,
  ) {
    return this.supplierProductsService.getSupplierProductsForRetailer(supplierMerchantId, retailerMerchantId);
  }
}
