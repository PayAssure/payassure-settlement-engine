export class IntegrationEntity {
  id: string = '';
  participantId: string = '';
  merchantId: string = '';
  apiKeyHash: string = '';
  apiSecretHash: string = '';
  environment: string = 'production';
  webhookUrl?: string | null = null;
  isActive: boolean = true;
  createdAt: Date = new Date();
  updatedAt: Date = new Date();
}
