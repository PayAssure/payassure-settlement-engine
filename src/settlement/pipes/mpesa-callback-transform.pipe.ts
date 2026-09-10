import { Injectable, PipeTransform, ArgumentMetadata } from '@nestjs/common';

@Injectable()
export class MpesaCallbackTransformPipe implements PipeTransform {
  transform(value: any, metadata: ArgumentMetadata) {
    if (metadata.type !== 'body' || !value) {
      return value;
    }

    // If the payload is { Result: {...} }, extract and transform it
    if (value.Result && typeof value.Result === 'object') {
      const result = value.Result;
      
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
        
        Result: result,
      };

      return transformed;
    }

    return value;
  }
}
