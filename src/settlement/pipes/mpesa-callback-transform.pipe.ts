import { Injectable, PipeTransform, ArgumentMetadata, Logger } from '@nestjs/common';

@Injectable()
export class MpesaCallbackTransformPipe implements PipeTransform {
  private readonly logger = new Logger(MpesaCallbackTransformPipe.name);

  transform(value: any, metadata: ArgumentMetadata) {
    if (metadata.type !== 'body' || !value) {
      return value;
    }

    // Log raw incoming value
    this.logger.log('[MPESA_TRANSFORM] raw value before transformation', {
      valueKeys: Object.keys(value ?? {}),
      hasResult: !!value?.Result,
      rawValueJSON: JSON.stringify(value),
    });

    // If the payload is { Result: {...} }, extract and transform it
    if (value.Result && typeof value.Result === 'object') {
      const result = value.Result;
      
      this.logger.log('[MPESA_TRANSFORM] detected M-Pesa Result format, extracting', {
        resultKeys: Object.keys(result),
        resultCode: result.ResultCode,
        resultDesc: result.ResultDesc,
        transactionId: result.TransactionID,
        originatorConversationId: result.OriginatorConversationID,
        conversationId: result.ConversationID,
      });

      // Extract reference data if present
      let extractedReference = '';
      if (result.ReferenceData?.ReferenceItem && Array.isArray(result.ReferenceData.ReferenceItem)) {
        const billRefItem = result.ReferenceData.ReferenceItem.find((item: any) => item.Key === 'BillReferenceNumber');
        if (billRefItem?.Value) {
          extractedReference = billRefItem.Value;
        }
      }

      // Transform M-Pesa Result format to our DTO format
      const transformed = {
        // Map M-Pesa fields to our DTO fields
        resultCode: result.ResultCode,
        resultDescription: result.ResultDesc,
        originatorConversationId: result.OriginatorConversationID,
        conversationId: result.ConversationID,
        transactionId: result.TransactionID,
        
        // Use TransactionID or extracted reference
        reference: extractedReference || result.TransactionID || '',
        
        // Determine status based on ResultCode (0 = success)
        status: result.ResultCode === 0 ? 'SUCCESS' : 'FAILED',
        
        // Default values for expected fields
        party: value.party || 'SUPPLIER',
        merchantTransactionReference: value.merchantTransactionReference || extractedReference || '',
        supplierMerchantId: value.supplierMerchantId || '',
        providerReference: value.providerReference || result.TransactionID || '',
        amount: value.amount || undefined,
        
        // Preserve metadata and any other fields
        metadata: value.metadata || {
          resultCode: result.ResultCode,
          resultDesc: result.ResultDesc,
          originalResult: result,
        },
        
        // Include full Result for logging
        Result: result,
      };

      this.logger.log('[MPESA_TRANSFORM] transformation complete', {
        transformedKeys: Object.keys(transformed),
        reference: transformed.reference,
        status: transformed.status,
        resultCode: transformed.resultCode,
      });

      return transformed;
    }

    // If it's already in our format, return as is
    this.logger.log('[MPESA_TRANSFORM] payload is not M-Pesa Result format, passing through', {
      valueKeys: Object.keys(value),
    });

    return value;
  }
}
