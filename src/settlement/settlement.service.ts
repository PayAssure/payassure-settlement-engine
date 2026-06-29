import { Injectable } from '@nestjs/common';
import { SettlementRepository } from './settlement.repository';

@Injectable()
export class SettlementService {
  constructor(private readonly repo: SettlementRepository) {}

  async getHelloText(): Promise<string> {
    const h = await this.repo.findFirstHello();
    return h?.text ?? 'no hello found';
  }
}
